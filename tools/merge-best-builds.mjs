// Merge best-build shards (wfcalc optimize --all --shard i/n) into one best-builds.json.
// Usage: node tools/merge-best-builds.mjs <out.json> <part.json>...
import { readFileSync, writeFileSync } from "node:fs";

const [out, ...parts] = process.argv.slice(2);
if (!out || !parts.length) {
  console.error("usage: merge-best-builds.mjs <out.json> <part.json>...");
  process.exit(1);
}
let merged = null;
let entries = 0;
for (const file of parts) {
  const part = JSON.parse(readFileSync(file, "utf8"));
  if (!merged) merged = { ...part, targets: {} };
  else if (part.dataVersion !== merged.dataVersion) throw new Error(`${file}: data version ${part.dataVersion} != ${merged.dataVersion}`);
  for (const [target, weapons] of Object.entries(part.targets)) {
    merged.targets[target] ??= {};
    for (const [id, pair] of Object.entries(weapons)) {
      merged.targets[target][id] = pair;
      entries++;
    }
  }
}
writeFileSync(out, JSON.stringify(merged));
console.log(`merged ${parts.length} parts, ${entries} weapon/target entries -> ${out}`);
