// Incarnon evolutions scraped from wiki weapon pages (raw wikitext, cached). No wiki data module
// has them. Genesis weapons keep them on "<Family> Incarnon Genesis" with one value column per
// variant (Braton / Mk1 / Vandal / Prime) and X/Y placeholders; natural Incarnons on the weapon page.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cacheDir = join(dirname(fileURLToPath(import.meta.url)), "../.cache/wiki/pages");
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export interface ScrapedEvolution {
  name: string;
  /** Effect lines with markup stripped and this variant's X/Y filled in. */
  effects: string[];
  notes: string[];
}
export interface ScrapedTier {
  tier: number;
  options: ScrapedEvolution[];
}
export interface ScrapedWeapon {
  page: string;
  tiers: ScrapedTier[];
}

async function page(title: string): Promise<string | null> {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, title.replace(/[^\w.-]+/g, "_") + ".wiki");
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < MAX_AGE_MS && !process.argv.includes("--refresh")) {
    const t = readFileSync(file, "utf8");
    return t === "" ? null : t;
  }
  try {
    const res = await fetch(`https://wiki.warframe.com/w/${encodeURIComponent(title.replace(/ /g, "_"))}?action=raw`, {
      headers: { "User-Agent": "simulacrum-build-calculator (personal, non-commercial)" },
    });
    const text = res.ok ? await res.text() : "";
    writeFileSync(file, text);
    return text || null;
  } catch {
    return existsSync(file) ? readFileSync(file, "utf8") || null : null;
  }
}

/** Strip wiki markup to plain text. */
export function clean(s: string): string {
  let t = s.replace(/'''?/g, "").replace(/<br\s*\/?>/gi, " ");
  t = t.replace(/\[\[File:[^\]]*\]\]/g, "");
  t = t.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2").replace(/\[\[([^\]]*)\]\]/g, "$1");
  // {{D|Heat}}, {{M|Name|Label}}, {{A|Ability}}, {{WF|Name|Label}} -> last argument.
  for (let i = 0; i < 3; i++) t = t.replace(/\{\{([^{}]*)\}\}/g, (_, inner: string) => inner.split("|").at(-1)!.trim());
  return t.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function variantIndex(headers: string[], weaponName: string): number {
  const i = headers.findIndex((h) => h.toLowerCase() === weaponName.toLowerCase());
  if (i >= 0) return i;
  // Base weapon column is the one with the shortest name contained in this weapon's name.
  const base = headers.map((h, j) => [h, j] as const).filter(([h]) => weaponName.toLowerCase().includes(h.toLowerCase()));
  return base.length ? base.sort((a, b) => b[0].length - a[0].length)[0][1] : 0;
}

function substitute(text: string, values: Record<string, string>): string {
  // Values may carry their own unit ("18%", "0.6x"); drop it when the template already has one.
  // "+Yx" has no word boundary between Y and x: allow a trailing x/% unit.
  return text.replace(/\b([XYZW])(?![A-Za-wyz0-9])(%|x)?/g, (m, v: string, unit: string | undefined) => {
    const val = values[v];
    if (val == null) return m;
    return unit ? val.replace(/[%x]$/, "") + unit : val;
  });
}

function parseValues(cell: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of cell.matchAll(/\b([XYZW])\s*=\s*([+-]?[\d.]+%?x?)/g)) out[m[1]] = m[2];
  return out;
}

/** Parse the evolution table(s) of a page into tiers for one weapon variant. */
export function parseEvolutions(wikitext: string, weaponName: string): ScrapedTier[] {
  const lines = wikitext.split(/\r?\n/);
  const start = lines.findIndex((l) => /EVO\s*\d/.test(l));
  if (start < 0) return [];
  // Variant columns (Genesis): header cells with {{Weapon|Name...}} before the first EVO marker.
  const headers: string[] = [];
  for (let i = Math.max(0, start - 30); i < start; i++) {
    const m = lines[i].match(/^!.*\{\{Weapon\|([^}|]+)/);
    if (m) headers.push(m[1].trim());
  }
  const variant = headers.length ? variantIndex(headers, weaponName) : -1;

  const tiers = new Map<number, ScrapedEvolution[]>();
  let tier = 0;
  let cells: string[][] | null = null;
  let name = "";

  const flush = () => {
    if (!cells || !name || tier < 2) {
      cells = null;
      return;
    }
    // cells[0] = effect; then variant value cells (Genesis) or nothing; last = notes.
    const effect = cells[0] ?? [];
    let values: Record<string, string> = {};
    let notes: string[] = [];
    if (headers.length) {
      const valueCells = cells.slice(1, 1 + headers.length);
      const v = valueCells.length === 1 ? valueCells[0] : valueCells[variant] ?? [];
      values = parseValues(v.join(" "));
      notes = cells.slice(1 + valueCells.length).flat();
    } else {
      notes = cells.slice(1).flat();
    }
    const list = tiers.get(tier) ?? [];
    list.push({
      name,
      effects: effect.map((l) => clean(substitute(l, values))).filter((l) => l && l !== "-"),
      notes: notes.map(clean).filter((l) => l && l !== "-"),
    });
    tiers.set(tier, list);
    cells = null;
  };

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line.startsWith("|}")) {
      flush();
      // Some pages split tiers across tables; keep scanning until a non-evolution section starts.
      if (!lines.slice(i + 1, i + 40).some((l) => /EVO\s*\d/.test(l))) break;
      continue;
    }
    const evo = line.match(/^!.*EVO\s*(\d)/);
    if (evo) {
      flush();
      tier = Number(evo[1]);
      continue;
    }
    if (line.startsWith("|-") || line.startsWith("!")) {
      if (line.startsWith("|-")) flush();
      continue;
    }
    const nameMatch = line.match(/^\|.*?'''(.+?)'''/);
    if (nameMatch && cells === null) {
      name = clean(nameMatch[1]);
      cells = [];
      continue;
    }
    if (line.startsWith("|") && cells) {
      // New cell; content may follow on the same line after "style=... |".
      const after = line.replace(/^\|\s*/, "");
      const content = after.includes("|") && /style|colspan|rowspan|class/.test(after.split("|")[0]) ? after.slice(after.indexOf("|") + 1) : after;
      cells.push(content.trim() ? [content.trim()] : []);
      continue;
    }
    if (line.startsWith("*") && cells && cells.length) {
      cells[cells.length - 1].push(line.replace(/^\*+\s*/, ""));
    } else if (/^[XYZW]\s*=/.test(line) && cells && cells.length) {
      // A value cell continued on the next line ("X = 12" then "Y = 12").
      cells[cells.length - 1].push(line);
    }
  }
  flush();
  return [...tiers.entries()].sort((a, b) => a[0] - b[0]).map(([t, options]) => ({ tier: t, options }));
}

/** Scrape evolutions for each named weapon; returns weapon name -> tiers. */
export async function scrapeEvolutions(weapons: { name: string; family: string }[]): Promise<Record<string, ScrapedWeapon>> {
  const out: Record<string, ScrapedWeapon> = {};
  for (const w of weapons) {
    const family = w.family.replace(/^Mk1-/, "");
    const candidates = [`${w.name} Incarnon Genesis`, `${family} Incarnon Genesis`, w.name];
    for (const title of [...new Set(candidates)]) {
      const text = await page(title);
      if (!text) continue;
      const tiers = parseEvolutions(text, w.name);
      if (tiers.length) {
        out[w.name] = { page: title, tiers };
        break;
      }
    }
  }
  writeFileSync(join(cacheDir, "..", "evolutions.json"), JSON.stringify(out, null, 1));
  return out;
}
