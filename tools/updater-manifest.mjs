// Write the desktop updater manifest (latest.json) for a release from the signed installers.
// Usage: node tools/updater-manifest.mjs <tag> <owner/repo> <dir with installers and .sig files> <out.json>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [tag, repo, dir, out] = process.argv.slice(2);
if (!tag || !repo || !dir || !out) {
  console.error("usage: updater-manifest.mjs <tag> <owner/repo> <dir> <out.json>");
  process.exit(1);
}
const PLATFORMS = [
  ["-setup.exe", "windows-x86_64"],
  [".app.tar.gz", "darwin-aarch64"],
  [".AppImage", "linux-x86_64"],
];
const platforms = {};
for (const name of readdirSync(dir)) {
  const p = PLATFORMS.find(([suffix]) => name.endsWith(suffix));
  if (!p) continue;
  platforms[p[1]] = {
    signature: readFileSync(join(dir, `${name}.sig`), "utf8").trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`,
  };
}
if (!Object.keys(platforms).length) throw new Error(`no installers in ${dir}`);
const manifest = { version: tag.replace(/^v/, ""), notes: `https://github.com/${repo}/releases/tag/${tag}`, pub_date: new Date().toISOString(), platforms };
writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`${out}: ${Object.keys(platforms).join(", ")}`);
