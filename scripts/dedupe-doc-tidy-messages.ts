/**
 * Folds together Doc Tidy emails that were imported once per group alias
 * (same RFC 822 Message-ID, different Gmail id). See
 * design-log/2026-10-27-email-dedupe-by-rfc822-message-id.md.
 *
 *   npx ts-node --project scripts/tsconfig.json scripts/dedupe-doc-tidy-messages.ts           # dry run
 *   npx ts-node --project scripts/tsconfig.json scripts/dedupe-doc-tidy-messages.ts --apply   # make changes
 *
 * Steps:
 *   1. Backfill `rfc822MessageId` for captured emails missing it (metadata-only Gmail fetch).
 *   2. Group rows by workspace + Message-ID.
 *   3. Keep the row with the most parse progress (then the oldest), merge the
 *      others' TO addresses and Gmail ids into it, and delete the others along
 *      with their parse jobs and Drive files.
 */
import 'dotenv/config'
import mongoose, { Types } from 'mongoose'
import DocTidyMessage from '../src/models/DocTidyMessage'
import DocTidyParseJob from '../src/models/DocTidyParseJob'
import DocTidyRule from '../src/models/DocTidyRule'
import { resolveWorkspaceRefreshToken } from '../src/services/docTidy.service'
import { getRfc822MessageId } from '../src/services/gmail.service'
import { deleteDriveFile } from '../src/services/googleDrive.service'

const APPLY = process.argv.includes('--apply')

const STATUS_RANK: Record<string, number> = { completed: 3, processing: 2, pending: 2, failed: 1 }

interface Row {
  _id: Types.ObjectId
  gmailMessageId: string
  rfc822MessageId?: string
  aliasGmailMessageIds?: string[]
  to?: string[]
  subject?: string
  sentAt: Date
  createdAt: Date
  attachments?: { driveFileId?: string }[]
}

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')
  await mongoose.connect(uri)

  console.log(APPLY ? 'Mode: APPLY' : 'Mode: DRY RUN (pass --apply to make changes)')

  const rules = await DocTidyRule.find().select('_id workspaceId').lean()
  const rulesByWorkspace = new Map<string, Types.ObjectId[]>()
  for (const r of rules) {
    const key = r.workspaceId ? String(r.workspaceId) : ''
    rulesByWorkspace.set(key, [...(rulesByWorkspace.get(key) ?? []), r._id as Types.ObjectId])
  }

  let totalGroups = 0
  let totalRemoved = 0

  for (const [workspaceKey, ruleIds] of rulesByWorkspace) {
    const label = workspaceKey || '(no workspace)'
    const refreshToken = await resolveWorkspaceRefreshToken(workspaceKey || undefined)

    const rows = await DocTidyMessage.find({
      ruleId: { $in: ruleIds },
      gmailMessageId: { $not: /^pdf-import-/ },
    })
      .select('gmailMessageId rfc822MessageId aliasGmailMessageIds to subject sentAt createdAt attachments')
      .lean<Row[]>()

    // 1. Backfill the header for rows captured before it was stored.
    const missing = rows.filter((r) => !r.rfc822MessageId)
    if (missing.length && !refreshToken) {
      console.warn(`[${label}] ${missing.length} row(s) lack a Message-ID but no email source is connected; skipping them`)
    }
    let backfilled = 0
    if (refreshToken) {
      for (const row of missing) {
        try {
          const rfcId = await getRfc822MessageId(refreshToken, row.gmailMessageId)
          if (!rfcId) continue
          row.rfc822MessageId = rfcId
          backfilled += 1
          if (APPLY) await DocTidyMessage.updateOne({ _id: row._id }, { $set: { rfc822MessageId: rfcId } })
        } catch (err) {
          console.warn(`[${label}] could not fetch ${row.gmailMessageId}: ${(err as Error).message}`)
        }
      }
    }

    // 2. Group by Message-ID.
    const groups = new Map<string, Row[]>()
    for (const row of rows) {
      if (!row.rfc822MessageId) continue
      groups.set(row.rfc822MessageId, [...(groups.get(row.rfc822MessageId) ?? []), row])
    }
    const dupGroups = [...groups.values()].filter((g) => g.length > 1)

    console.log(`[${label}] ${rows.length} email(s), backfilled ${backfilled}, duplicate group(s): ${dupGroups.length}`)
    if (!dupGroups.length) continue

    const jobs = await DocTidyParseJob.find({ messageId: { $in: dupGroups.flat().map((r) => r._id) } })
      .select('messageId status')
      .lean()
    const progress = new Map<string, number>()
    for (const job of jobs) {
      const key = String(job.messageId)
      progress.set(key, Math.max(progress.get(key) ?? 0, STATUS_RANK[job.status] ?? 0))
    }

    // 3. Keep one row per group, fold the rest into it.
    for (const group of dupGroups) {
      group.sort(
        (a, b) =>
          (progress.get(String(b._id)) ?? 0) - (progress.get(String(a._id)) ?? 0) ||
          a.createdAt.getTime() - b.createdAt.getTime()
      )
      const [keep, ...drop] = group
      totalGroups += 1
      totalRemoved += drop.length

      console.log(
        `  "${keep.subject}" (${keep.sentAt.toISOString().slice(0, 10)}): keep ${keep._id}, remove ${drop.map((d) => d._id).join(', ')}`
      )
      if (!APPLY) continue

      const mergedTo = [...new Set(group.flatMap((r) => r.to ?? []))]
      const aliasIds = [...new Set(drop.flatMap((r) => [r.gmailMessageId, ...(r.aliasGmailMessageIds ?? [])]))]
      await DocTidyMessage.updateOne(
        { _id: keep._id },
        { $set: { to: mergedTo }, $addToSet: { aliasGmailMessageIds: { $each: aliasIds } } }
      )

      const dropIds = drop.map((r) => r._id)
      await DocTidyParseJob.deleteMany({ messageId: { $in: dropIds } })
      await DocTidyMessage.deleteMany({ _id: { $in: dropIds } })

      const driveFileIds = drop.flatMap((r) => (r.attachments ?? []).map((a) => a.driveFileId).filter(Boolean) as string[])
      if (refreshToken && driveFileIds.length) {
        await Promise.allSettled(driveFileIds.map((fileId) => deleteDriveFile({ refreshToken }, fileId)))
      }
    }
  }

  console.log(`${APPLY ? 'Removed' : 'Would remove'} ${totalRemoved} duplicate row(s) across ${totalGroups} email(s)`)
  await mongoose.disconnect()
}

main().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
