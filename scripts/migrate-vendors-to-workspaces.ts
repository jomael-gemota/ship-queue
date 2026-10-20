/**
 * One-time migration: assign existing vendors (without a workspaceId) to their
 * matching workspace, matched by name (same strategy as rules migration).
 *
 * Usage:
 *   npx ts-node scripts/migrate-vendors-to-workspaces.ts
 *   npx ts-node scripts/migrate-vendors-to-workspaces.ts --dry-run
 */
import '../src/config/env';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db';
import DocTidyVendor from '../src/models/DocTidyVendor';
import DocTidyWorkspace from '../src/models/DocTidyWorkspace';

const DRY_RUN = process.argv.includes('--dry-run');

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

(async () => {
  await connectDB();

  const [vendors, workspaces] = await Promise.all([
    DocTidyVendor.find({ workspaceId: { $exists: false } }).lean(),
    DocTidyWorkspace.find().lean(),
  ]);

  if (vendors.length === 0) {
    console.log('✅  No unassigned vendors found. Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  console.log(`\nFound ${vendors.length} unassigned vendor(s) and ${workspaces.length} workspace(s).\n`);
  if (DRY_RUN) console.log('DRY RUN — no changes will be written.\n');

  const assigned: { vendorName: string; workspaceName: string }[] = [];
  const unmatched: string[] = [];

  for (const vendor of vendors) {
    const normVendor = normalize(vendor.name);

    // 1. Exact match
    let match = workspaces.find((ws) => normalize(ws.name) === normVendor);

    // 2. Partial match
    if (!match) {
      match = workspaces.find(
        (ws) => normVendor.includes(normalize(ws.name)) || normalize(ws.name).includes(normVendor)
      );
    }

    if (!match) {
      unmatched.push(vendor.name);
      console.log(`  ⚠️   "${vendor.name}" — no matching workspace found`);
      continue;
    }

    assigned.push({ vendorName: vendor.name, workspaceName: match.name });
    console.log(`  ✅  "${vendor.name}" → workspace "${match.name}"`);

    if (!DRY_RUN) {
      await DocTidyVendor.updateOne({ _id: vendor._id }, { $set: { workspaceId: match._id } });
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Assigned:   ${assigned.length}`);
  console.log(`  Unmatched:  ${unmatched.length}`);
  if (unmatched.length > 0) {
    console.log(`\n  Unmatched vendors (still need manual assignment):`);
    for (const name of unmatched) console.log(`    - ${name}`);
  }
  if (DRY_RUN && assigned.length > 0) {
    console.log('\n  Re-run without --dry-run to apply these assignments.');
  }

  await mongoose.disconnect();
})();
