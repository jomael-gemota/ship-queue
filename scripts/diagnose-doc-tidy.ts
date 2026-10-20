/**
 * Read-only diagnostic for Doc Tidy extraction.
 *
 * Reports which mailbox is connected, what each rule compiles to, and how many
 * messages a series of progressively looser Gmail queries return — which
 * pinpoints whether the problem is the connected account, the mailbox contents,
 * or the rule's criteria.
 */
import '../src/config/env';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db';
import { getDocTidyConfigDoc } from '../src/models/DocTidyConfig';
import DocTidyRule from '../src/models/DocTidyRule';
import DocTidyMessage from '../src/models/DocTidyMessage';
import { buildGmailQuery, buildGmailClient, listMessageIds, getMessage } from '../src/services/gmail.service';

async function countFor(refreshToken: string, query: string): Promise<string> {
  try {
    const ids = await listMessageIds(refreshToken, query, 50);
    return String(ids.length) + (ids.length === 50 ? '+' : '');
  } catch (err) {
    return `ERROR: ${(err as Error).message}`;
  }
}

(async () => {
  await connectDB();

  const config = await getDocTidyConfigDoc(true);
  console.log('\n=== CONNECTED MAILBOX ===');
  console.log('connected      :', Boolean(config.gmailRefreshToken));
  console.log('account email  :', config.gmailAccountEmail || '(none)');
  console.log('connected at   :', config.gmailConnectedAt || '(none)');
  console.log('drive folder   :', config.driveFolderName || '(root)', config.driveFolderId || '');

  const refreshToken = config.gmailRefreshToken;
  if (!refreshToken) {
    console.log('\nNo mailbox connected — nothing further to check.');
    await mongoose.disconnect();
    return;
  }

  // Confirm which mailbox the token actually opens, and how big it is.
  console.log('\n=== MAILBOX PROFILE (who the token really is) ===');
  try {
    const gmail = buildGmailClient(refreshToken);
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log('emailAddress   :', profile.data.emailAddress);
    console.log('messagesTotal  :', profile.data.messagesTotal);
    console.log('threadsTotal   :', profile.data.threadsTotal);
  } catch (err) {
    console.log('FAILED:', (err as Error).message);
  }

  console.log('\n=== CONTROL QUERIES (is there anything to find?) ===');
  const controls: [string, string][] = [
    ['everything (no query)', ''],
    ['anywhere incl. spam/trash', 'in:anywhere'],
    ['has attachment', 'has:attachment'],
    ['last 30 days', 'newer_than:30d'],
    ['last 365 days', 'newer_than:365d'],
    ['to: invoice@outdoorequipped.com', 'to:invoice@outdoorequipped.com'],
    ['cc/bcc/deliveredto invoice@', 'deliveredto:invoice@outdoorequipped.com'],
    ['anywhere + invoice@ mention', 'in:anywhere invoice@outdoorequipped.com'],
    // Google Groups stamps List-ID/List-Post; this is the reliable marker that
    // the connected mailbox is actually receiving the group's mail.
    ['list: invoice@ (group delivery)', 'list:invoice@outdoorequipped.com'],
  ];
  for (const [label, q] of controls) {
    console.log(`  ${label.padEnd(34)} -> ${await countFor(refreshToken, q)}`);
  }

  console.log('\n=== SAMPLE OF WHAT IS ACTUALLY IN THE MAILBOX ===');
  try {
    const ids = await listMessageIds(refreshToken, 'in:anywhere', 5);
    if (!ids.length) {
      console.log('  Mailbox appears to be empty.');
    }
    for (const id of ids) {
      const m = await getMessage(refreshToken, id);
      console.log(
        `  ${m.sentAt.toISOString().slice(0, 10)} | from=${m.from} | to=${m.to.join(',')} | att=${m.attachments.length} | ${m.subject.slice(0, 60)}`
      );
    }
  } catch (err) {
    console.log('  FAILED:', (err as Error).message);
  }

  console.log('\n=== RULES ===');
  const rules = await DocTidyRule.find();
  if (!rules.length) console.log('  (no rules defined)');

  for (const rule of rules) {
    const query = buildGmailQuery({
      fromAddresses: rule.fromAddresses,
      toAddresses: rule.toAddresses,
      subjectKeywords: rule.subjectKeywords,
      bodyKeywords: rule.bodyKeywords,
      excludeKeywords: rule.excludeKeywords,
      matchMode: rule.matchMode,
      dateFrom: rule.dateFrom,
      dateTo: rule.dateTo,
      lookbackDays: rule.lookbackDays,
      requireAttachment: rule.requireAttachment,
    });

    console.log(`\n  Rule: ${rule.name}  (enabled=${rule.enabled})`);
    console.log('    from           :', JSON.stringify(rule.fromAddresses));
    console.log('    delivered to   :', JSON.stringify(rule.toAddresses));
    console.log('    subject        :', JSON.stringify(rule.subjectKeywords));
    console.log('    body           :', JSON.stringify(rule.bodyKeywords));
    console.log('    exclude        :', JSON.stringify(rule.excludeKeywords));
    console.log('    matchMode      :', rule.matchMode);
    console.log('    lookbackDays   :', rule.lookbackDays ?? '(none)');
    console.log('    dateFrom/To    :', rule.dateFrom ?? '(none)', '/', rule.dateTo ?? '(none)');
    console.log('    requireAttach  :', rule.requireAttachment);
    console.log('    extensions     :', JSON.stringify(rule.attachmentExtensions));
    console.log('    lastRunError   :', rule.lastRunError ?? '(none)');
    console.log('    COMPILED QUERY :', JSON.stringify(query));
    console.log('    gmail hits     :', await countFor(refreshToken, query));

    // Narrow down which clause is eliminating everything.
    console.log('    --- without attachment requirement ---');
    console.log(
      '    hits           :',
      await countFor(
        refreshToken,
        buildGmailQuery({
          fromAddresses: rule.fromAddresses,
          subjectKeywords: rule.subjectKeywords,
          bodyKeywords: rule.bodyKeywords,
          excludeKeywords: rule.excludeKeywords,
          matchMode: rule.matchMode,
          lookbackDays: rule.lookbackDays,
          requireAttachment: false,
        })
      )
    );
    console.log('    --- sender clause only ---');
    console.log(
      '    hits           :',
      await countFor(refreshToken, buildGmailQuery({ fromAddresses: rule.fromAddresses }))
    );
    console.log('    --- keywords only (no date, no attachment) ---');
    console.log(
      '    hits           :',
      await countFor(
        refreshToken,
        buildGmailQuery({
          subjectKeywords: rule.subjectKeywords,
          bodyKeywords: rule.bodyKeywords,
          matchMode: rule.matchMode,
        })
      )
    );
  }

  console.log('\n=== STORED RESULTS ===');
  console.log('  DocTidyMessage count:', await DocTidyMessage.countDocuments());

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('Diagnostic failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
