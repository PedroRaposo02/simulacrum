// Galvanized / Condition Overload on guns ("GunCO"): whether the per-status damage bonus adds to
// base damage or multiplies it, per weapon attack, and its CO factor. Source: the community
// spreadsheet "Galvanized GunCO on Projectiles" (rainy, tests by Prof_Blocks_007), newest tab first.
import XLSX from "xlsx";

export interface GunCoRow {
  name: string;
  factor: number;
  mode: "adds" | "multiplies";
  singleTarget: number | null;
  notes: string;
  edition: string;
}

const EDITIONS = ["38.0.12 Edition", "32.2.10 Edition"];

export function readGunCo(path: string): GunCoRow[] {
  const wb = XLSX.readFile(path);
  const seen = new Set<string>();
  const rows: GunCoRow[] = [];
  for (const edition of EDITIONS) {
    const sheet = wb.Sheets[edition];
    if (!sheet) continue;
    const table: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    // Columns (both editions): Check, Group, Weapon, CO Factor, +Damage Math, Single-Target Value, Notes…
    for (const r of table) {
      const name = String(r[2] ?? "").trim();
      const factor = r[3];
      const math = String(r[4] ?? "").trim().toLowerCase();
      if (!name || typeof factor !== "number" || !(math === "adds" || math === "multiplies")) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue; // newer edition wins
      seen.add(key);
      rows.push({
        name,
        factor,
        mode: math as "adds" | "multiplies",
        singleTarget: typeof r[5] === "number" ? r[5] : null,
        notes: [r[6], r[9], r[12]].map((x) => String(x ?? "").trim()).filter(Boolean).join(" "),
        edition,
      });
    }
  }
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => norm(s).split(" ").filter(Boolean);

export interface GunCoMatch {
  row: GunCoRow;
  weapon: string;
  /** Mode indices it applies to; all modes when the sheet row names just the weapon. */
  modes: number[];
}

/**
 * Match sheet rows to weapons (longest weapon-name prefix) and attack modes (remaining words found
 * in the mode or component names). Returns matches and the rows that couldn't be placed.
 */
export function matchGunCo(rows: GunCoRow[], weapons: { name: string; modes: { name: string; components: { name: string }[] }[] }[]) {
  const compact = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byLength = [...weapons].sort((a, b) => compact(b.name).length - compact(a.name).length);
  const matches: GunCoMatch[] = [];
  const unmatched: GunCoRow[] = [];
  // Sheet attack words -> words that appear in our mode / component names.
  const ALIAS: Record<string, string[]> = {
    quickshot: ["uncharged", "quick", "partially"],
    quick: ["uncharged", "quick", "partially"],
    uncharged: ["uncharged", "quick", "partially", "normal"],
    halfcharge: ["partially"],
    half: ["partially"],
    fullcharge: ["charged"],
    full: ["charged"],
    charged: ["charged"],
    bomblets: ["cluster", "bomblets"],
    airbonk: ["air", "burst"],
    hitscan: ["hit", "scan", "hitscan"],
    aoe: ["aoe", "radial", "explosion"],
    direct: ["impact", "direct", "contact"],
    throw: ["throw", "spear"],
  };
  for (const row of rows) {
    const rowWords = words(row.name);
    let w: (typeof weapons)[number] | undefined;
    let rest: string[] = [];
    for (const cand of byLength) {
      const target = compact(cand.name);
      let acc = "";
      let i = 0;
      while (i < rowWords.length && acc.length < target.length) acc += compact(rowWords[i++]);
      if (acc === target) {
        w = cand;
        rest = rowWords.slice(i);
        break;
      }
    }
    if (!w) {
      unmatched.push(row);
      continue;
    }
    // Join hyphenated pairs the sheet writes as one idea ("Full-Charge", "Alt-fire").
    const joined = rest.join(" ").replace(/\bfull charge\b/, "fullcharge").replace(/\bhalf charge\b/, "halfcharge").replace(/\balt fire\b/, "alt").replace(/\bprimary fire\b/, "primary");
    rest = joined.split(" ").filter((x) => x && !["shot", "mode", "attack", "fire"].includes(x));
    if (!rest.length) {
      matches.push({ row, weapon: w.name, modes: w.modes.map((_, i) => i) });
      continue;
    }
    if (rest.length === 1 && rest[0] === "primary") {
      matches.push({ row, weapon: w.name, modes: [0] });
      continue;
    }
    const want = rest.flatMap((x) => ALIAS[x] ?? [x]);
    const score = (text: string) => want.filter((x) => words(text).includes(x)).length;
    let scored = w.modes
      .map((m, i) => ({ i, s: Math.max(score(m.name), ...m.components.map((c) => score(c.name))) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    // "Alt-fire" with no mode named that way: the weapon's second, non-Incarnon mode.
    if (!scored.length && rest.includes("alt")) {
      const alt = w.modes.findIndex((m, i) => i > 0 && !/incarnon/i.test(m.name));
      if (alt > 0) scored = [{ i: alt, s: 1 }];
    }
    if (!scored.length) {
      unmatched.push(row);
      continue;
    }
    const top = scored[0].s;
    matches.push({ row, weapon: w.name, modes: scored.filter((x) => x.s === top).map((x) => x.i) });
  }
  return { matches, unmatched };
}
