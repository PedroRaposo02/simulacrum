// Downloads the wiki data modules we use (raw Lua, cached) and writes them as JSON next to the cache.
// Wiki content is CC BY-NC-SA 3.0: attribution in the app footer, data stays non-commercial.
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { luaTable } from "./lua.ts";

const cacheDir = join(dirname(fileURLToPath(import.meta.url)), "../.cache/wiki");
const MAX_AGE_MS = 24 * 3600 * 1000;

const MODULES: { module: string; out: string; local?: string }[] = [
  { module: "Module:Weapons/data/melee", out: "melee.json" },
  { module: "Module:Weapons/data/primary", out: "primary.json" },
  { module: "Module:Weapons/data/secondary", out: "secondary.json" },
  { module: "Module:Stances/data", out: "stances.json", local: "StanceData" },
];

async function fetchRaw(module: string): Promise<string> {
  const file = join(cacheDir, module.replace(/[:/]/g, "_") + ".lua");
  const fresh = existsSync(file) && Date.now() - statSync(file).mtimeMs < MAX_AGE_MS && !process.argv.includes("--refresh");
  if (fresh) return readFileSync(file, "utf8");
  try {
    const res = await fetch(`https://wiki.warframe.com/w/${module}?action=raw`, {
      headers: { "User-Agent": "simulacrum-build-calculator (personal, non-commercial)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    writeFileSync(file, text);
    return text;
  } catch (e) {
    if (existsSync(file)) {
      console.warn(`${module}: fetch failed (${e}); using cached copy`);
      return readFileSync(file, "utf8");
    }
    throw e;
  }
}

export async function fetchWiki() {
  mkdirSync(cacheDir, { recursive: true });
  for (const m of MODULES) {
    const lua = await fetchRaw(m.module);
    const data = luaTable(lua, m.local);
    writeFileSync(join(cacheDir, m.out), JSON.stringify(data));
    console.log(`${m.module}: ${Object.keys(data).length} entries -> ${m.out}`);
  }
}

export function wikiJson(name: string): any {
  return JSON.parse(readFileSync(join(cacheDir, name), "utf8"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await fetchWiki();
}
