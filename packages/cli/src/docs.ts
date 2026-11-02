import path from "node:path";
import { readStore, recheckStore, renderDocs, scan, writeAnalysis, type Analysis } from "@houserules/core";

async function freshAnalysis(root: string): Promise<Analysis> {
  const a = await scan(root);
  await writeAnalysis(root, a);
  return a;
}

export async function runRender(target: string): Promise<number> {
  const root = path.resolve(target);
  const result = await renderDocs(root, await readStore(root));
  console.log(`Rendered ${result.items} item(s):`);
  for (const f of result.written) console.log(`  ${f}`);
  if (result.emptySections.length) console.log(`\nStill empty (run houserules in your agent to fill): ${result.emptySections.join(", ")}`);
  return 0;
}

/** Re-checks stored docs against the current code. Exit code 1 when anything is broken. */
export async function runVerify(target: string, opts: { json: boolean }): Promise<number> {
  const root = path.resolve(target);
  const analysis = await freshAnalysis(root);
  const report = await recheckStore(root, analysis);
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return report.broken.length ? 1 : 0;
  }
  if (report.total === 0) {
    console.log("No generated docs yet. Run `houserules generate` to write them.");
    return 0;
  }
  console.log(`Checked ${report.total} item(s): ${report.broken.length} broken, ${report.changed.length} with changed evidence.`);
  for (const b of report.broken) {
    console.log(`\n✗ ${b.doc}/${b.section}: ${b.title}`);
    for (const p of b.problems) console.log(`    ${p}`);
  }
  for (const c of report.changed) {
    console.log(`\n~ ${c.doc}/${c.section}: ${c.title}`);
    for (const p of c.problems) console.log(`    ${p}`);
  }
  return report.broken.length ? 1 : 0;
}
