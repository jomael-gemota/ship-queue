/**
 * One-time migration: assign existing rules (without a workspaceId) to their
 * matching workspace, matched by name.
 *
 * Matching order:
 *   1. Exact match (case-insensitive) between rule.name and workspace.name.
 *   2. Partial match: workspace.name is contained in rule.name, or vice versa.
 *
 * Usage:
 *   npx ts-node scripts/migrate-rules-to-workspaces.ts
 *
 * Add --dry-run to preview matches without writing to the database.
 */
import '../src/config/env';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db';
import DocTidyRule from '../src/models/DocTidyRule';
import DocTidyWorkspace from '../src/models/DocTidyWorkspace';

const DRY_RUN = process.argv.includes('--dry-run');

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

(async () => {
  await connectDB();

  const [rules, workspaces] = await Promise.all([
    DocTidyRule.find({ workspaceId: { $exists: false } }).lean(),
    DocTidyWorkspace.find().lean(),
  ]);

  if (rules.length === 0) {
    console.log('✅  No unassigned rules found. Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  console.log(`\nFound ${rules.length} unassigned rule(s) and ${workspaces.length} workspace(s).\n`);
  if (DRY_RUN) console.log('DRY RUN — no changes will be written.\n');

  const assigned: { ruleName: string; workspaceName: string }[] = [];
  const unmatched: string[] = [];

  for (const rule of rules) {
    const normRule = normalize(rule.name);

    // 1. Exact match
    let match = workspaces.find((ws) => normalize(ws.name) === normRule);

    // 2. Partial match (workspace name inside rule name, or rule name inside workspace name)
    if (!match) {
      match = workspaces.find(
        (ws) => normRule.includes(normalize(ws.name)) || normalize(ws.name).includes(normRule)
      );
    }

    if (!match) {
      unmatched.push(rule.name);
      console.log(`  ⚠️   "${rule.name}" — no matching workspace found`);
      continue;
    }

    assigned.push({ ruleName: rule.name, workspaceName: match.name });
    console.log(`  ✅  "${rule.name}" → workspace "${match.name}"`);

    if (!DRY_RUN) {
      await DocTidyRule.updateOne({ _id: rule._id }, { $set: { workspaceId: match._id } });
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Assigned:   ${assigned.length}`);
  console.log(`  Unmatched:  ${unmatched.length}`);
  if (unmatched.length > 0) {
    console.log(`\n  Unmatched rules (still need manual assignment):`);
    for (const name of unmatched) console.log(`    - ${name}`);
  }
  if (DRY_RUN && assigned.length > 0) {
    console.log('\n  Re-run without --dry-run to apply these assignments.');
  }

  await mongoose.disconnect();
})();
