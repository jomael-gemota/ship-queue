/**
 * Rewrites table-view corrections stored with `correctedOutput: { tables }`
 * into the agent's JSON shape, rebuilt from `correctedTables` and the
 * correction's `originalOutput`.
 *
 * See design-log/2026-10-09-doc-tidy-tabular-corrections-as-json.md.
 *
 * Usage: npx ts-node scripts/migrate-tabular-corrections.ts [--apply]
 * Without --apply it only prints what would change.
 */
import '../src/config/env';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db';
import DocTidyCorrection from '../src/models/DocTidyCorrection';
import { isAgentTable, tablesToAgentJson } from '../src/services/docTidyTables.service';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await connectDB();

  const corrections = await DocTidyCorrection.find({ 'correctedOutput.tables': { $exists: true } })
    .select('_id vendorName mode correctedOutput correctedTables originalOutput originalTables')
    .lean();

  let updated = 0;
  for (const c of corrections) {
    const source = Array.isArray(c.correctedTables)
      ? c.correctedTables
      : (c.correctedOutput as { tables?: unknown }).tables;
    const tables = Array.isArray(source) ? source.filter(isAgentTable) : [];
    if (tables.length === 0) {
      console.log(`skip ${c._id} (${c.vendorName ?? 'no vendor'}): no usable tables`);
      continue;
    }

    const output = tablesToAgentJson(tables, c.originalOutput, c.originalTables);
    console.log(`${apply ? 'update' : 'would update'} ${c._id} (${c.vendorName ?? 'no vendor'})`);
    console.log(`  keys: ${Object.keys(output).join(', ')}`);

    if (apply) {
      await DocTidyCorrection.updateOne({ _id: c._id }, { $set: { correctedOutput: output } });
      updated++;
    }
  }

  console.log(`${corrections.length} found, ${updated} updated${apply ? '' : ' (dry run)'}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
