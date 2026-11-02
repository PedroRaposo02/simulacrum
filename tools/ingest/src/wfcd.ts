// Builds data/gamedata.json from @wfcd/items (MIT) plus data/overrides.
// First source of the pipeline; Public Export, public-export-plus and the wiki join later.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWiki, wikiJson } from "./fetch-wiki.ts";
import { meleeModes, wikiMeleeEntry } from "./melee.ts";
import { scrapeEvolutions, type ScrapedEvolution } from "./evolutions.ts";
import { matchGunCo, readGunCo } from "./gunco.ts";
import { existsSync } from "node:fs";

await fetchWiki();

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const wfcdDir = join(dirname(fileURLToPath(import.meta.url)), "../node_modules/@wfcd/items/data/json");
const wfcdVersion: string = JSON.parse(readFileSync(join(wfcdDir, "../../package.json"), "utf8")).version;
const load = (f: string) => JSON.parse(readFileSync(join(wfcdDir, f), "utf8"));
const STANCE_MODS = new Map<string, { baseDrain: number; fusionLimit: number; polarity: string }>(
  (load("Mods.json") as any[]).filter((m) => m.type === "Stance Mod").map((m) => [m.name, m]),
);
const override = (f: string) => JSON.parse(readFileSync(join(root, "data/overrides", f), "utf8"));

type Stat = { kind: string; of?: string };
type Modifier = {
  source: string; stat: Stat; value: number; maxStacks?: number; condition?: string; per?: string; appliesTo?: string; threshold?: number;
  aiming?: boolean; trigger?: string; modeContains?: string;
};

/** Split off "per Status Type" / "per Combo Multiplier" qualifiers. */
function splitPer(text: string): [string, string | undefined] {
  const st = text.replace(/ per Status Type affecting the target/i, "");
  if (st !== text) return [st, "statusType"];
  const cm = text.replace(/ (?:per|stacks with) Combo Multiplier/i, "");
  if (cm !== text) return [cm, "comboMultiplier"];
  return [text, undefined];
}

function withPer(m: Modifier, per: string | undefined, statName: string): Modifier {
  if (per) m.per = per;
  if (/^Direct Damage$/.test(statName.trim())) m.appliesTo = "directOnly";
  return m;
}

const ELEMENTS: Record<string, string> = {
  Heat: "heat", Cold: "cold", Electricity: "electricity", Toxin: "toxin", Blast: "blast",
  Radiation: "radiation", Gas: "gas", Magnetic: "magnetic", Viral: "viral", Corrosive: "corrosive",
};
const PHYSICAL: Record<string, string> = { Impact: "impact", Puncture: "puncture", Slash: "slash" };
const FACTIONS: Record<string, string> = {
  Grineer: "grineer", Corpus: "corpus", Infested: "infested", Orokin: "corrupted", Corrupted: "corrupted",
  Murmur: "murmur", Sentient: "sentient",
};
const DAMAGE_KEYS: Record<string, string> = { ...ELEMENTS, ...PHYSICAL, Void: "void", Tau: "tau", True: "true" };

// Stats that never change damage output; dropped instead of reported as unparsed.
const IRRELEVANT = /Punch Through|Recoil|Ammo Maximum|Ammo Pick Up|Projectile Speed|Zoom|Accuracy|Health Orbs|Minimap|Movement Speed|Holstered|Heal Rate|Shield Recharge|hear gunfire|Beam Range|Blast Range|Flight Speed|Holster|Chance to Explode|'\w+'|Ammo Efficiency|Spread|Sprint Speed|Dodge Speed|Revive Speed|Combo Count|Life Steal|Mobility|Slide|Combo Duration|Heavy Attack Efficiency|Wind Up|Finisher|Range|Bounce|Initial Combo|Channeling|Block|Parry|Throw/i;

function statOf(rawName: string): Stat | null {
  // Case-insensitive match against the canonical stat names.
  const canon = ["Damage", "Direct Damage", "Melee Damage", "Attack Speed", "Multishot", "Critical Chance", "Critical Damage", "Status Chance", "Fire Rate", "Magazine Capacity", "Reload Speed", "Status Duration", "Headshot Damage", "Weak Point Damage"];
  let name = rawName;
  const hit = canon.find((c) => c.toLowerCase() === rawName.trim().toLowerCase());
  if (hit) name = hit;
  // Drop qualifiers such as "(x2 for Bows)" or "(x2 for Heavy Attacks)"; the base effect is what normal attacks get.
  name = name.trim().replace(/\s*\(x\d+ for [^)]+\)/, "");
  if (name === "Damage" || name === "Direct Damage" || name === "Melee Damage") return { kind: "baseDamage" };
  if (name === "Attack Speed") return { kind: "fireRate" };
  if (name === "Multishot") return { kind: "multishot" };
  if (name === "Critical Chance") return { kind: "critChance" };
  if (name === "Critical Damage") return { kind: "critDamage" };
  if (name === "Status Chance") return { kind: "statusChance" };
  if (name === "Fire Rate") return { kind: "fireRate" };
  if (name === "Magazine Capacity") return { kind: "magazine" };
  if (name === "Reload Speed") return { kind: "reloadSpeed" };
  if (name === "Status Duration") return { kind: "statusDuration" };
  if (name === "to Headshot Multiplier" || name === "Weak Point Damage" || name === "Headshot Damage") return { kind: "headshotDamage" };
  if (PHYSICAL[name]) return { kind: "physical", of: PHYSICAL[name] };
  if (ELEMENTS[name]) return { kind: "element", of: ELEMENTS[name] };
  return null;
}

const CONDITIONS: Record<string, string> = {
  "On Kill": "onKill", "On Headshot": "onHeadshot", "On Headshot Kill": "onHeadshotKill",
  "On Reload": "onReload", "On Weak Point Kill": "onHeadshotKill", "On Weak Point Hit": "onHeadshot",
  "On Melee Kill": "onKill",
};

/** Melee-specific lines: flat range, heavy-only damage, wind-up, Tennokai effects. */
function parseMeleeLine(source: string, line: string): Modifier[] | null {
  const flat = line.match(/^([+-][\d.]+) Range$/);
  if (flat) return [{ source, stat: { kind: "range" }, value: +flat[1] }];
  const heavy = line.match(/^([+-][\d.]+)% Melee Damage on Heavy Attack$/);
  if (heavy) return [{ source, stat: { kind: "baseDamage" }, value: +heavy[1] / 100, appliesTo: "heavyOnly" }];
  const wind = line.match(/^([+-][\d.]+)% Heavy Attack Wind Up Speed$/);
  if (wind) return [{ source, stat: { kind: "windUpSpeed" }, value: +wind[1] / 100 }];
  // "+220% Critical Chance (x2 for Heavy Attacks)": base value for all hits, the same again for heavies.
  const x2 = line.match(/^([+-][\d.]+)% (.+?) \(x2 for Heavy Attacks\)$/);
  if (x2) {
    const stat = statOf(x2[2]);
    if (stat) return [{ source, stat, value: +x2[1] / 100 }, { source: `${source} (heavy x2)`, stat, value: +x2[1] / 100, appliesTo: "heavyOnly" }];
  }
  if (/Enables Tennokai/i.test(line)) {
    const out: Modifier[] = [];
    const dmg = line.match(/increases? Tennokai damage by ([\d.]+)%/i);
    if (dmg) {
      const onKill = /Tennokai kills/i.test(line);
      out.push({ source, stat: { kind: "baseDamage" }, value: +dmg[1] / 100, appliesTo: "tennokaiOnly", ...(onKill ? { condition: "onKill" } : {}) });
    }
    const sc = line.match(/status chance by \+?([\d.]+)% on Tennokai/i);
    if (sc) out.push({ source, stat: { kind: "statusChance" }, value: +sc[1] / 100, appliesTo: "tennokaiOnly" });
    const cd = line.match(/critical damage by ([\d.]+)% for Tennokai/i);
    if (cd) out.push({ source, stat: { kind: "critDamage" }, value: +cd[1] / 100, appliesTo: "tennokaiOnly" });
    return out;
  }
  return null;
}

/** Parse one stat line into modifiers; "when Aiming" effects are flagged (companion AI never aims). */
function parseLine(source: string, raw: string): Modifier[] | null {
  if (/ when Aiming/i.test(raw)) {
    const r = parseLineInner(source, raw.replace(/ when Aiming/gi, ""));
    return r && r.map((m) => ({ ...m, aiming: true }));
  }
  return parseLineInner(source, raw);
}

function parseLineInner(source: string, raw: string): Modifier[] | null {
  const line = raw.replace(/<[^>]+>/g, "").replace(/\\n/g, "\n").trim();
  const melee = parseMeleeLine(source, line.replace(/\s+/g, " "));
  if (melee) return melee;
  const faction = line.match(/^x([\d.]+) Damage to (\w+)$/);
  const factionKey = faction && (FACTIONS[faction[2]] ?? FACTIONS[faction[2].replace(/s$/, "")]);
  if (faction && factionKey) {
    return [{ source, stat: { kind: "factionDamage", of: factionKey }, value: +faction[1] - 1 }];
  }
  const cond = line.match(/^(On [\w ]+?):\s*\n?([\s\S]+)$/);
  if (cond) {
    const condition = CONDITIONS[cond[1]];
    const [bodyText, per] = splitPer(cond[2].trim());
    const body = bodyText.match(/^([+-][\d.]+)% ([A-Za-z ]+?)(?: when Aiming)?(?: for [\d.]+s)?\.?(?: Stacks up to (\d+)x\.?)?$/);
    if (!condition || !body) return null;
    const stat = statOf(body[2]);
    if (!stat) return IRRELEVANT.test(body[2]) ? [] : null;
    return [withPer({ source: `${source} (${cond[1].toLowerCase()})`, stat, value: +body[1] / 100, maxStacks: body[3] ? +body[3] : 1, condition }, per, body[2])];
  }
  const [plainText, per] = splitPer(line);
  const plain = plainText.match(/^([+-][\d.]+)% (.+)$/);
  if (plain) {
    const stat = statOf(plain[2]);
    if (stat) return [withPer({ source, stat, value: +plain[1] / 100 }, per, plain[2])];
  }
  return IRRELEVANT.test(line) ? [] : null;
}

// ---- Incarnon evolutions -------------------------------------------------------------------

// Effects that never change damage output.
const EVO_IRRELEVANT = /Ammo|Magazine|Transmutation|Overshield|Accuracy|Punch Through|Recoil|Projectile Speed|Movement|Holster|Reload Speed|Sprint|Parkour|Aim Glid|Slide|Finisher|Parry|Block|Armor Over|Bounce|Zoom|Range|Instant Reload|Health|Shield Gate|Energy restored|Radar|Ammo Efficiency/i;

// Triggers that depend on loadout or play style rather than on shooting: off unless enabled in the scenario.
const SITUATIONAL = /overshield|channeled ability|shield break|shield\/overguard|sprint speed|energy max|armor over|energy spent|ability cast|undamaged|punch through|on equip/i;

const EVO_CONDITIONS: [RegExp, string][] = [
  [/^On Kill/i, "onKill"],
  [/^On Headshot Kill|^On Weak ?point Kill/i, "onHeadshotKill"],
  [/^On Headshot|^On Weak ?point Hit|^On Consecutive Weakpoint/i, "onHeadshot"],
  [/^On Reload/i, "onReload"],
];

/** One evolution sentence -> modifiers; null if it can't be read. `cond` is a "With …:" / "On …:" prefix in effect. */
function parseEvolutionSentence(source: string, text: string, cond: string | null): Modifier[] | null {
  let t = text.trim().replace(/\.$/, "");
  let maxStacks = 1;
  const stacks = t.match(/\s*Stacks? up to (\d+)(?:x| times)\.?$/i);
  if (stacks) {
    maxStacks = +stacks[1];
    t = t.slice(0, stacks.index).trim().replace(/\.$/, "");
  }
  t = t
    .replace(/\s*Effect doubles in Incarnon Form\.?$/i, "")
    .replace(/ for [\d.]+ ?s(?:econds?)?$/i, "")
    .replace(/ for Incarnon Form$/i, "")
    .trim();
  const undamaged = / on undamaged enemies$/i.test(t);
  if (undamaged) {
    t = t.replace(/ on undamaged enemies$/i, "");
    cond ??= "On undamaged enemies";
  }
  const withCond = (m: Modifier): Modifier => {
    if (maxStacks > 1) m.maxStacks = maxStacks;
    if (!cond) return m;
    const below = cond.match(/Critical Chance Below ([\d.]+)%/i);
    if (below) return { ...m, condition: "critChanceBelow", threshold: +below[1] / 100 };
    const known = EVO_CONDITIONS.find(([re]) => re.test(cond));
    // Other triggers use the uptime slider; situational ones ("With Overshields", "On Shield Break"...) also need
    // their scenario toggle.
    return {
      ...m,
      source: `${m.source} (${cond.toLowerCase()})`,
      condition: known ? known[1] : "onKill",
      ...(SITUATIONAL.test(cond) ? { trigger: cond.toLowerCase() } : {}),
    };
  };
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^Increase (?:Base )?Damage by \+?([\d.]+)$/i))) return [withCond({ source, stat: { kind: "baseDamageFlat" }, value: +m[1] })];
  if ((m = t.match(/^Increase Critical Chance by \+?([\d.]+)%$/i))) return [withCond({ source, stat: { kind: "critChance" }, value: +m[1] / 100 })];
  if ((m = t.match(/^Increase Status Chance by \+?([\d.]+)%$/i))) return [withCond({ source, stat: { kind: "statusChance" }, value: +m[1] / 100 })];
  if ((m = t.match(/^Increase Base Status Chance by \+?([\d.]+)% of current Critical Chance, up to \+?([\d.]+)%$/i)))
    return [withCond({ source, stat: { kind: "statusChanceBaseFromCrit" }, value: +m[1] / 100, threshold: +m[2] / 100 })];
  if ((m = t.match(/^Increase Base Critical Chance by \+?([\d.]+)% of current Status Chance, up to \+?([\d.]+)%$/i)))
    return [withCond({ source, stat: { kind: "critChanceBaseFromStatus" }, value: +m[1] / 100, threshold: +m[2] / 100 })];
  if ((m = t.match(/^Increase Base Critical Chance by \+?([\d.]+)%$/i))) return [withCond({ source, stat: { kind: "critChanceBase" }, value: +m[1] / 100 })];
  if ((m = t.match(/^Increase Base Critical (?:Damage )?Multiplier by \+?([\d.]+)x$/i))) return [withCond({ source, stat: { kind: "critMultBase" }, value: +m[1] })];
  if ((m = t.match(/^Increase Base Status(?: Chance)? by \+?([\d.]+)%(?: per projectile)?$/i))) return [withCond({ source, stat: { kind: "statusChanceBase" }, value: +m[1] / 100 })];
  if ((m = t.match(/^Multishot consumes ammo directly from Capacity and (?:does|increases Damage by) \+?([\d.]+)%(?: Damage)?$/i)))
    return [withCond({ source, stat: { kind: "multishotDamage" }, value: +m[1] / 100 })];
  if ((m = t.match(/^\+?([\d.]+) (?:Base )?Multishot$/i))) return [withCond({ source, stat: { kind: "multishot" }, value: +m[1] })];
  // "Increase Base Status Chance to 12%": set, so add the difference to the weapon's base.
  if ((m = t.match(/^Increase Base Status Chance to \+?([\d.]+)%$/i)))
    return [withCond({ source, stat: { kind: "statusChanceBase" }, value: Math.max(0, +m[1] / 100 - evoBaseStatus) })];
  // "Reload increases Fire Rate by +10% per shell" (Felarx): a reload from empty loads the whole magazine.
  if ((m = t.match(/^Reload increases Fire Rate by \+?([\d.]+)% per shell$/i)) && evoMagazine > 0)
    return [{ source: `${source} (${evoMagazine} shells reloaded)`, stat: { kind: "fireRate" }, value: (+m[1] / 100) * evoMagazine }];
  if (/^Resets on (?:reload|missed shot)$/i.test(t)) return [];
  // "+3 Multishot on last shot in magazine": one shot per magazine, so its average over the magazine.
  if ((m = t.match(/^\+?([\d.]+) Multishot on last shot in magazine$/i)) && evoMagazine > 0)
    return [{ source: `${source} (last shot, averaged over ${evoMagazine})`, stat: { kind: "multishot" }, value: +m[1] / evoMagazine }];
  // "Enemies suffering from fewer than 3 Status Effects will receive: +100% Critical Damage"
  if ((m = t.match(/^Enemies suffering from fewer than (\d+) Status Effects will receive:?\s*\+?([\d.]+)% ([A-Za-z ]+)$/i))) {
    const stat = statOf(m[3]);
    if (stat) return [{ source: `${source} (fewer than ${m[1]} statuses)`, stat, value: +m[2] / 100, condition: "statusTypesBelow", threshold: +m[1] }];
  }
  // "+25% Multishot if no enemies are within 5m": situational, uses the uptime slider.
  if ((m = t.match(/^([+-]?[\d.]+)% ([A-Za-z ]+?) if (.+)$/))) {
    const stat = statOf(m[2]);
    if (stat) return [{ source: `${source} (if ${m[3]})`, stat, value: +m[1] / 100, condition: "onKill" }];
  }
  // A timed bonus with no trigger named ("+50% Headshot damage for 8 seconds") is situational too.
  if (!cond && (m = text.trim().replace(/\.$/, "").match(/^([+-]?[\d.]+)% ([A-Za-z ]+?) for [\d.]+ ?s(?:econds?)?$/i))) {
    const stat = statOf(m[2]);
    if (stat) return [{ source: `${source} (timed)`, stat, value: +m[1] / 100, condition: "onKill" }];
  }
  // A plain stat behind any trigger ("On Firing: +20% Multishot").
  if (cond && (m = t.match(/^([+-]?[\d.]+)% ([A-Za-z ]+)$/))) {
    const stat = statOf(m[2]);
    if (stat) return [withCond({ source, stat, value: +m[1] / 100 })];
    if (EVO_IRRELEVANT.test(m[2])) return [];
  }
  // Standard stat lines ("+20% Fire Rate", "+40% Direct Damage per Status Type…").
  const std = parseLine(source, cond && !/Critical Chance Below/i.test(cond) ? `${cond}:\n${t}${maxStacks > 1 ? ` Stacks up to ${maxStacks}x.` : ""}` : t);
  if (std && std.length) {
    if (cond && /Critical Chance Below/i.test(cond)) return std.map(withCond);
    return std;
  }
  if (std && !std.length) return [];
  return EVO_IRRELEVANT.test(t) ? [] : null;
}

const NAMED_BEHAVIOURS: Record<string, (text: string) => any | null> = {
  "Devouring Attrition": (t) => {
    const m = t.match(/([\d.]+)% chance to deal \+?([\d.]+)% damage on non-critical/i);
    return m ? { kind: "devouringAttrition", chance: +m[1] / 100, bonus: +m[2] / 100, ignoredByBosses: true } : null;
  },
  "Overwhelming Attrition": (t) => {
    const m = t.match(/\+?([\d.]+)% damage for ([\d.]+) ?s(?:econds?)?\. Stacks up to (\d+)/i);
    return m ? { kind: "overwhelmingAttrition", bonus: +m[1] / 100, maxStacks: +m[3], durationS: +m[2] } : null;
  },
};

function evolutionForms(e: ScrapedEvolution): string {
  const all = [...e.effects, ...e.notes].join(" ");
  if (/(does not|doesn't) (apply|affect)(?: to)? (?:the )?Incarnon Form|Only affects (?:the )?(?:untransformed|normal)/i.test(all)) return "normal";
  if (/Only (?:affects|applies to|active in) (?:the )?Incarnon Form|for Incarnon Form/i.test(all) && !/both (forms|modes)/i.test(all)) return "incarnon";
  return "both";
}

// Magazine and base status chance of the weapon whose evolutions are being parsed.
let evoMagazine = 0;
let evoBaseStatus = 0;

// Hand definitions per option name (data/overrides/incarnon.json "options"), for mechanics the text parser
// can't read. `keepParsed` keeps what the parser finds and adds these on top.
const optionDefs: Record<string, any> = override("incarnon.json").options ?? {};

function parseEvolution(e: ScrapedEvolution) {
  const text = e.effects.join(" ");
  const def = optionDefs[e.name];
  if (def && !def.keepParsed) {
    return {
      name: e.name, text, forms: def.forms ?? evolutionForms(e),
      ...(def.modifiers?.length ? { modifiers: def.modifiers } : {}),
      ...(def.behaviour ? { behaviour: def.behaviour } : {}),
    };
  }
  if (def) {
    const parsed: any = parseEvolutionText(e, text);
    return {
      ...parsed,
      forms: def.forms ?? parsed.forms,
      ...(def.modifiers?.length || parsed.modifiers ? { modifiers: [...(parsed.modifiers ?? []), ...(def.modifiers ?? [])] } : {}),
      ...(def.behaviour ? { behaviour: def.behaviour } : {}),
      unparsed: undefined,
    };
  }
  return parseEvolutionText(e, text);
}

function parseEvolutionText(e: ScrapedEvolution, text: string) {
  // Named mechanics are recognised by their text, since a few weapons reuse them under other names.
  for (const fn of Object.values(NAMED_BEHAVIOURS)) {
    const behaviour = fn(text);
    if (behaviour) return { name: e.name, text, forms: evolutionForms(e), behaviour };
  }
  const modifiers: Modifier[] = [];
  const unparsed: string[] = [];
  for (const bullet of e.effects) {
    let cond: string | null = null;
    let body = bullet.replace(/\s+/g, " ").trim();
    const prefix = body.match(/^((?:On|With|While)[^:]{2,60}):\s*(.*)$/i);
    if (prefix) {
      cond = prefix[1].trim();
      body = prefix[2];
    }
    // Sentences: split on ". " but keep decimals; re-attach "Stacks up to" to the clause before it.
    const parts = body.split(/\.\s+(?=[A-Z+\-])/).map((x) => x.trim()).filter(Boolean);
    const merged: string[] = [];
    for (const part of parts) {
      if (/^Stacks? up to/i.test(part) && merged.length) merged[merged.length - 1] += `. ${part}`;
      else merged.push(part);
    }
    for (const sentence of merged) {
      // "+20% Multishot" inside a multishot-damage line is a separate stat.
      const r = parseEvolutionSentence(e.name, sentence, cond);
      if (r) modifiers.push(...r);
      else unparsed.push(sentence);
    }
  }
  // "Bonuses are added after mods as a flat value": crit/status chance become flat additions.
  if (e.notes.some((n) => /after mods as a flat value|added as a flat/i.test(n))) {
    for (const m of modifiers) {
      if (m.stat.kind === "critChance") m.stat = { kind: "critChanceFlat" };
      else if (m.stat.kind === "statusChance") m.stat = { kind: "statusChanceFlat" };
    }
  }
  return {
    name: e.name,
    text,
    forms: evolutionForms(e),
    ...(modifiers.length ? { modifiers } : {}),
    ...(unparsed.length ? { unparsed } : {}),
  };
}

const POOLS: Record<string, string> = {
  "Primary Mod": "primary", "Shotgun Mod": "shotgun", "Secondary Mod": "secondary", "Arch-Gun Mod": "archGun",
  "Melee Mod": "melee",
};
const GENERIC_COMPAT = new Set(["primary", "unique", "rifle", "pistol", "shotgun", "archgun", "thrown", "rifle (no aoe)", "pistol (no aoe)", "melee"]);

const exclusivity: string[][] = override("mod-exclusivity.json").groups;
function exclusiveGroup(name: string, pool: string): string | undefined {
  const g = exclusivity.find((grp) => grp.includes(name));
  if (g) return `${pool}:${g[0]}`;
  const stem = name.replace(/^(Primed|Amalgam|Umbral|Sacrificial) /, "");
  return `${pool}:${stem}`;
}

function buildMods() {
  const all = (load("Mods.json") as any[]).filter((m) => POOLS[m.type] && (m.levelStats?.length || /Enables Tennokai/i.test(m.description ?? "")));
  // Datamined, unreleased mods (e.g. "Soaring Truth"): no wiki page and no drop source.
  const unreleased = all.filter((m) => !m.wikiaUrl && !(m.drops?.length));
  console.log(`unreleased mods dropped (${unreleased.length}): ${unreleased.map((m) => m.name).join(", ")}`);
  const mods = all.filter((m) => !unreleased.includes(m));
  const out = mods.map((m) => {
    const pool = POOLS[m.type];
    const compatRaw = String(m.compatName ?? "").toLowerCase();
    const compat = GENERIC_COMPAT.has(compatRaw) || !compatRaw ? null : compatRaw;
    const modifiers: Modifier[] = [];
    const unparsed: string[] = [];
    const lines: string[] = m.levelStats?.at(-1)?.stats ?? [];
    // Tennokai mods put everything in one sentence block; parse it whole.
    const parts = lines.flatMap((line) => (/Enables Tennokai/i.test(line) ? [line] : line.split(/\n(?=On )|\\n(?=On )/)));
    for (const line of parts) {
      for (const part of [line]) {
        const r = parseLine(m.name, part);
        if (r) modifiers.push(...r);
        else unparsed.push(part.replace(/<[^>]+>/g, "").replace(/\\n/g, " "));
      }
    }
    const desc = String(m.description ?? "");
    const requiresTrigger = /Only compatible with Semi-Auto/i.test(desc) ? "semi" : undefined;
    const locksFireRate = /Fire Rate cannot be modified/i.test(desc) || undefined;
    const enablesTennokai = /Enables Tennokai/i.test(desc + lines.join(" ")) || undefined;
    return {
      id: m.uniqueName, name: m.name, pool, compat, polarity: m.polarity ?? "", baseDrain: m.baseDrain ?? 0,
      maxRank: m.fusionLimit ?? 0, isExilus: !!(m.isUtility || m.isExilus), exclusiveGroup: exclusiveGroup(m.name, pool),
      modifiers, ...(requiresTrigger ? { requiresTrigger } : {}), ...(locksFireRate ? { locksFireRate } : {}), ...(enablesTennokai ? { enablesTennokai } : {}), unparsed,
      ...(m.rarity ? { rarity: m.rarity } : {}),
      ...(m.imageName ? { image: `https://cdn.warframestat.us/img/${m.imageName}` } : {}),
    };
  });
  // Same name can appear several times (beginner, PvP variants); keep the full version.
  // "Expert" paths are primed variants; under an unprimed name they are unreleased placeholders.
  // Among the rest the plainest internal path is the released mod (e.g. WeaponMeleeDamageMod, not ...OnHeavyKillMod).
  const rank = (m: { id: string; name: string; maxRank: number }) =>
    (/Beginner|PvP|Conclave/i.test(m.id) ? -1000 : 0) + (/Expert/.test(m.id) && !/^Primed /.test(m.name) ? -500 : 0) - m.id.length;
  const best = new Map<string, (typeof out)[number]>();
  for (const m of out) if (!best.has(m.name) || rank(m) > rank(best.get(m.name)!)) best.set(m.name, m);
  const deduped = [...best.values()];
  // Groups that only one mod belongs to carry no information.
  const counts = new Map<string, number>();
  for (const m of deduped) counts.set(m.exclusiveGroup!, (counts.get(m.exclusiveGroup!) ?? 0) + 1);
  for (const m of deduped) if (counts.get(m.exclusiveGroup!) === 1) delete (m as any).exclusiveGroup;
  return deduped;
}

function buildArcanes() {
  const { behaviours, defs } = override("arcanes.json") as { behaviours: Record<string, string>; defs: Record<string, any> };
  // Shotgun and bow arcanes go in the primary slot, restricted by weapon class (set in defs).
  const SLOT_OF: Record<string, string> = {
    "Primary Arcane": "primary", "Secondary Arcane": "secondary", "Melee Arcane": "melee",
    "Shotgun Arcane": "primary", "Bow Arcane": "primary",
  };
  return (load("Arcanes.json") as any[])
    .filter((a) => SLOT_OF[a.type] && a.levelStats?.length)
    .map((a) => {
      const slot = SLOT_OF[a.type];
      const def = defs[a.name];
      const first = String(a.levelStats.at(-1).stats[0] ?? "").replace(/<[^>]+>/g, "");
      const segs = first.split(/\\n|\n/).map((s) => s.trim()).filter(Boolean);
      const modifiers: Modifier[] = [];
      // Hand definitions win; melee arcane wording is too varied to parse reliably.
      if (def) modifiers.push(...(def.modifiers ?? []));
      else if (!behaviours[a.name] && slot !== "melee") {
        let i = 0;
        if (segs[0]?.endsWith(":") && segs[1]) {
          modifiers.push(...(parseLine(a.name, `${segs[0]}\n${segs[1]}`) ?? []));
          i = 2;
        }
        for (const s of segs.slice(i)) modifiers.push(...(parseLine(a.name, s) ?? []));
      }
      return {
        id: a.uniqueName, name: a.name, slot,
        behaviour: behaviours[a.name] ?? null, modifiers, description: segs.join(" "),
        ...(def?.classes ? { classes: def.classes } : {}),
        ...(def?.stacking ? { stacking: def.stacking } : {}),
        ...(def?.comboFloor ? { comboFloor: def.comboFloor } : {}),
        ...(a.rarity ? { rarity: a.rarity } : {}),
        ...(a.imageName ? { image: `https://cdn.warframestat.us/img/${a.imageName}` } : {}),
      };
    });
}

const CLASS: Record<string, string> = {
  Rifle: "rifle", Shotgun: "shotgun", Sniper: "sniper", Bow: "bow", Launcher: "launcher", Pistol: "pistol",
  "Dual Pistols": "pistol", Throwing: "thrown", "Arch-Gun": "archGun", "Companion Weapon": "companion",
};
const TRIGGER: Record<string, string> = {
  Auto: "auto", Semi: "semi", Held: "held", "Auto Burst": "burst", Burst: "burst", Active: "active", Charge: "charge", Duplex: "duplex",
};
const SLOT: Record<string, string> = { Primary: "primary", Secondary: "secondary", Melee: "melee", "Arch-Gun": "archGun", SentinelWeapons: "companion" };

/** Mod pool a weapon takes. Companion weapons borrow the pool matching their internal path. */
function modPoolOf(slot: string, cls: string, uniqueName: string): string {
  if (slot === "companion") {
    if (/Melee|Glaive/i.test(uniqueName)) return "melee";
    if (/Shotgun/i.test(uniqueName)) return "shotgun";
    if (/Pistol/i.test(uniqueName)) return "secondary";
    return "primary";
  }
  if (cls === "shotgun") return "shotgun";
  return ({ primary: "primary", secondary: "secondary", melee: "melee", archGun: "archGun" } as Record<string, string>)[slot];
}

const FAMILY_AFFIXES = /^(Kuva|Tenet|Coda|Prisma|Mara|Dex|Synoid|Telos|Sancti|Rakta|Secura|Vaykor|Carmine|Ak|Twin|Mk1-) | (Prime|Vandal|Wraith|Prisma)$/g;

const incarnon: Record<string, { rounds?: number; rechargeS?: number; evolutions?: any[] }> = override("incarnon.json").weapons;

// Incarnon magazine sizes from the wiki gun modules: attack-level IncarnonCharges, keyed by internal path.
const wikiIncarnonRounds = new Map<string, number>();
// Gauge charge per weak point hit (IncarnonChargeGain), weapon-level.
const wikiChargeGain = new Map<string, number>();
for (const file of ["primary.json", "secondary.json"]) {
  for (const w of Object.values(wikiJson(file)) as any[]) {
    const atk = (w?.Attacks ?? []).find((a: any) => a?.IncarnonCharges);
    if (w?.InternalName && atk) wikiIncarnonRounds.set(w.InternalName, atk.IncarnonCharges);
    if (w?.InternalName && w.IncarnonChargeGain) wikiChargeGain.set(w.InternalName, w.IncarnonChargeGain);
  }
}
// Charged by any direct hit instead of weak point hits (Incarnon page).
const CHARGE_ON_ANY_HIT = /^(Angstrum|Torid)\b/;

function kindOf(a: any): string {
  if (a.shot_type === "AoE") return "radial";
  if (a.shot_type === "DoT") return "dotCloud";
  if (a.shot_type === "Thrown") return "thrown";
  return "direct";
}

function damageMap(d: Record<string, number>) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(d ?? {})) {
    const key = DAMAGE_KEYS[k[0].toUpperCase() + k.slice(1)] ?? (k === "true" ? "true" : null);
    if (key && v > 0) out[key] = (out[key] ?? 0) + v;
  }
  return out;
}

// Wiki gun entries by internal path: per-attack multishot (WFCD only has the weapon's).
const wikiGuns = new Map<string, any>();
for (const file of ["primary.json", "secondary.json"]) {
  for (const w of Object.values(wikiJson(file)) as any[]) if (w?.InternalName) wikiGuns.set(w.InternalName, w);
}
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function buildWeapon(w: any, slotFile: string) {
  const isMelee = slotFile === "Melee";
  const weaponMultishot = w.multishot ?? 1;
  const wikiAttacks: any[] = wikiGuns.get(w.uniqueName)?.Attacks ?? [];
  const attackMultishot = (name: string): number => {
    const a = wikiAttacks.find((x) => normName(x.AttackName ?? "") === normName(name));
    return a ? a.Multishot ?? 1 : weaponMultishot;
  };
  const modes: any[] = [];
  const tags = new Set<string>();
  for (const a of w.attacks ?? []) {
    const isIncarnon = /Incarnon/i.test(a.name);
    const comp = {
      name: a.name, kind: kindOf(a), damage: damageMap(a.damage),
      critChance: (a.crit_chance ?? 0) / 100, critMult: a.crit_mult ?? 1, statusChance: (a.status_chance ?? 0) / 100,
      multishot: attackMultishot(a.name), ...(a.falloff ? { falloff: { startM: a.falloff.start, endM: a.falloff.end, reduction: a.falloff.reduction ?? 0 } } : {}),
      rules: { canHeadshot: kindOf(a) !== "radial", receivesMultishot: true, comboScaling: isMelee && /Heavy/i.test(a.name) },
    };
    const prev = modes.at(-1);
    const sameRate = prev && (a.speed == null || prev.fireRate === a.speed || prev.chargeTimeS === a.charge_time);
    if (comp.kind === "radial" && prev && sameRate && !isMelee) {
      if (prev.components[0].kind !== "radial" && /hit-?scan/i.test(prev.shotType)) comp.rules.receivesMultishot = false;
      prev.components.push(comp);
      tags.add("radialChild");
      continue;
    }
    const notes: string[] = [];
    if (a.falloff) notes.push(`Damage falloff ignored (assumes ${comp.kind === "radial" ? "blast centre" : "point blank"})`);
    if (w.trigger?.includes("Burst")) notes.push("Burst delay not modelled; listed fire rate used");
    if (/Kuva|Tenet/.test(w.name)) { notes.push("Progenitor bonus element not included"); tags.add("progenitor"); }
    if (isMelee) {
      notes.push("Melee: attack speed used as hits per second; stance and combo multipliers not modelled");
      if (/Heavy/i.test(a.name)) notes.push("Heavy attack at full combo every hit: an upper bound (combo is consumed, wind-up not modelled)");
      tags.add("melee");
    }
    const inc = incarnon[w.name];
    const hasDamage = Object.keys(comp.damage).length > 0;
    const hasRate = (a.speed ?? 0) > 0 || (a.charge_time ?? 0) > 0;
    const eventTriggered = /Reload|On Kill|Death/i.test(a.name);
    if (isIncarnon) tags.add("incarnon");
    if (a.charge_time) tags.add("charge");
    modes.push({
      name: a.name, shotType: a.shot_type ?? "",
      trigger: isMelee ? "other" : a.charge_time ? "charge" : TRIGGER[w.trigger] ?? "other",
      fireRate: a.speed ?? 0, magazine: isIncarnon || isMelee ? null : w.magazineSize ?? null, reloadS: isMelee ? 0 : w.reloadTime ?? 0,
      ...(a.charge_time ? { chargeTimeS: a.charge_time } : {}),
      ammoPool: isIncarnon
        ? {
          kind: "incarnon", rounds: inc?.rounds ?? wikiIncarnonRounds.get(w.uniqueName) ?? null, recharge_s: inc?.rechargeS ?? null,
          ...(wikiChargeGain.has(w.uniqueName) ? { charge_gain: wikiChargeGain.get(w.uniqueName) } : {}),
          ...(CHARGE_ON_ANY_HIT.test(w.name) ? { charge_on_any_hit: true } : {}),
        }
        : isMelee ? { kind: "none" } : { kind: "magazine" },
      ...(isIncarnon ? { incarnonForm: true } : {}),
      shot: w.trigger === "Held" ? "beam" : a.shot_type === "Projectile" ? "projectile" : a.shot_type === "Thrown" ? "thrown" : a.shot_type === "AoE" ? "aoe" : "hitscan",
      components: [comp],
      ...(isMelee && !/^Normal Attack$/i.test(a.name) ? { headline: false } : {}),
      coverage: hasDamage && hasRate && !eventTriggered ? "computed" : "unsupported",
      notes: eventTriggered
        ? ["Triggered by an event (reload, kill, explosion), not by firing; event attacks not modelled yet"]
        : hasDamage && hasRate ? notes : [hasDamage ? "No fire rate or charge time in source data" : "No damage in source data"],
    });
  }
  for (const m of modes) delete m.shotType;
  let melee: any;
  if (isMelee) {
    const entry = wikiMeleeEntry(w.uniqueName, w.name);
    const normalAtk = (w.attacks ?? []).find((a: any) => /^Normal Attack$/i.test(a.name));
    const attackSpeed = entry?.Attacks?.[0]?.FireRate ?? normalAtk?.speed ?? w.fireRate ?? 1;
    for (const m of modes) m.meleeRole = /^Normal Attack$/i.test(m.name) ? "light" : "other";
    if (entry && normalAtk) {
      const normal = {
        damage: damageMap(normalAtk.damage),
        critChance: (normalAtk.crit_chance ?? 0) / 100,
        critMult: normalAtk.crit_mult ?? 1,
        statusChance: (normalAtk.status_chance ?? 0) / 100,
      };
      const extra = meleeModes(entry, normal, attackSpeed);
      if (extra.stances.length) {
        for (const m of modes) {
          if (/^Normal Attack$/i.test(m.name)) {
            m.name = "Normal Attack (no stance)";
            m.headline = false;
          }
        }
      }
      // Wiki heavy attack replaces the WFCD heavy entries (which lack wind-up).
      for (let i = modes.length - 1; i >= 0; i--) if (/^Heavy Attack$/i.test(modes[i].name)) modes.splice(i, 1);
      modes.push(...extra.modes);
      tags.add("stances");
      melee = {
        class: entry.Class, attackSpeed, rangeM: entry.MeleeRange ?? 0, followThrough: entry.FollowThrough ?? 1,
        comboDurationS: entry.ComboDur ?? 5, heavyDamage: entry.HeavyAttack ?? 0, windUpS: entry.WindUp ?? 1,
        stances: extra.stances,
      };
    }
  }
  const slot = SLOT[slotFile];
  const cls = isMelee ? "melee" : CLASS[w.type] ?? "rifle";
  // A max-rank stance adds its drain as capacity, doubled in a matching stance slot: best of the weapon's stances.
  const stanceCapacity = Math.max(
    0,
    ...(melee?.stances ?? []).map((n: string) => {
      const s = STANCE_MODS.get(n);
      return s ? (-s.baseDrain + s.fusionLimit) * (s.polarity === w.stancePolarity ? 2 : 1) : 0;
    }),
  );
  return {
    id: w.uniqueName, name: w.name, slot, class: cls, modPool: modPoolOf(slot, cls, w.uniqueName),
    family: w.name.replace(FAMILY_AFFIXES, "").trim(), modes, innate: [], mechanicTags: [...tags],
    image: w.imageName ? `https://cdn.warframestat.us/img/${w.imageName}` : undefined,
    ...(melee ? { melee } : {}),
    ...(w.polarities?.length ? { polarities: w.polarities } : {}),
    ...(w.exilusPolarity ? { exilusPolarity: w.exilusPolarity } : {}),
    ...(w.stancePolarity ? { stancePolarity: w.stancePolarity } : {}),
    ...(stanceCapacity > 0 ? { stanceCapacity } : {}),
    // Kuva Lich / Sister of Parvos weapons carry a progenitor bonus element.
    ...(/^(Kuva|Tenet) /.test(w.name) ? { progenitor: true } : {}),
    ...(incarnon[w.name]?.evolutions ? { evolutions: incarnon[w.name].evolutions } : {}),
    sources: { base: "wfcd", attacks: "wfcd (wiki-derived)", ...(melee ? { melee: "wiki Module:Weapons/data/melee + Module:Stances/data" } : {}) },
  };
}

// Drifter / Operator weapons (Sirocco, Rumblejack) and anything listed in excluded-weapons.json.
const excluded = override("excluded-weapons.json");
function isExcluded(w: any): boolean {
  return (
    excluded.names.includes(w.name) ||
    excluded.pathPrefixes.some((p: string) => String(w.uniqueName).startsWith(p)) ||
    excluded.productCategories.includes(w.productCategory)
  );
}

function buildWeapons() {
  const files: [string, string][] = [
    ["Primary", "Primary.json"], ["Secondary", "Secondary.json"], ["Melee", "Melee.json"],
    ["Arch-Gun", "Arch-Gun.json"], ["SentinelWeapons", "SentinelWeapons.json"],
  ];
  const out: any[] = [];
  for (const [slot, f] of files) {
    for (const w of load(f) as any[]) {
      if (!w.attacks?.length || w.uniqueName.includes("/PvPVariant")) continue;
      if (isExcluded(w)) continue;
      if (slot === "Melee" && w.type !== "Melee") continue;
      if (slot === "Primary" && w.type === "Pistol") w.type = "Rifle";
      out.push(buildWeapon(w, slot));
    }
  }
  const seen = new Set<string>();
  return out.filter((w) => !seen.has(w.name) && seen.add(w.name));
}

const weapons = buildWeapons();
// Incarnon evolutions: scraped from wiki pages, parsed into modifiers; hand-curated entries in
// data/overrides/incarnon.json win.
{
  const incarnonWeapons = weapons.filter((w) => w.modes.some((m: any) => m.incarnonForm));
  const scraped = await scrapeEvolutions(incarnonWeapons.map((w) => ({ name: w.name, family: w.family })));
  for (const w of incarnonWeapons) {
    if (w.evolutions) continue;
    const s = scraped[w.name];
    if (!s) continue;
    evoMagazine = w.modes.find((m: any) => m.magazine)?.magazine ?? 0;
    evoBaseStatus = w.modes[0]?.components?.[0]?.statusChance ?? 0;
    w.evolutions = s.tiers.map((t) => ({ tier: t.tier, options: t.options.map(parseEvolution) }));
    w.sources.evolutions = `wiki ${s.page}`;
  }
}
// GunCO: additive vs multiplicative per-status damage, per weapon attack (community sheet).
const gunCoSheet = join(root, "attachments/Galvanized GunCO on Projectiles - 32.2.10 edition.xlsx");
let gunCoReport: any = { sheet: "missing" };
if (existsSync(gunCoSheet)) {
  const rows = readGunCo(gunCoSheet);
  const guns = weapons.filter((w) => w.slot !== "melee");
  const { matches, unmatched } = matchGunCo(rows, guns);
  let applied = 0;
  for (const m of matches) {
    const w = guns.find((x) => x.name === m.weapon)!;
    for (const i of m.modes) {
      for (const c of w.modes[i].components) {
        c.rules.gunCo = { factor: m.row.factor, mode: m.row.mode === "multiplies" ? "multiplies" : "adds" };
        applied++;
      }
    }
  }
  gunCoReport = { rows: rows.length, matched: matches.length, components: applied, unmatched: unmatched.map((r) => `${r.name} (${r.mode}, ${r.factor}) [${r.edition}]`) };
  console.log(`GunCO sheet: ${rows.length} rows, ${matches.length} matched (${applied} attack components), ${unmatched.length} unmatched`);
}
const mods = buildMods();
const arcanes = buildArcanes();
const enemies = override("enemies.json").enemies;
const { _note: _rivenNote, source: _rivenSource, readOn: _rivenReadOn, ...riven } = override("riven.json");
const buffs = override("buffs.json").buffs;
const { _note: _rulesNote, ...rules } = override("optimizer-rules.json");
const body = { weapons, mods, arcanes, enemies, riven, buffs, rules };
const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
const gamedata = {
  version: hash, generatedAt: new Date().toISOString(),
  sources: {
    gunco: "Galvanized GunCO on Projectiles sheet (rainy, tests by Prof_Blocks_007)",
    wfcd: `@wfcd/items ${wfcdVersion} (MIT)`,
    wiki: "wiki.warframe.com melee and stance modules (CC BY-NC-SA 3.0)",
    overrides: "data/overrides",
  },
  ...body,
};

const outPath = join(root, "data/gamedata.json");
writeFileSync(outPath, JSON.stringify(gamedata));
mkdirSync(join(root, "apps/web/public"), { recursive: true });
copyFileSync(outPath, join(root, "apps/web/public/gamedata.json"));

const modesN = weapons.reduce((n, w) => n + w.modes.length, 0);
const unsupported = weapons.flatMap((w) => w.modes.filter((m: any) => m.coverage === "unsupported").map((m: any) => `${w.name} / ${m.name}`));
const unparsedMods = mods.filter((m) => m.unparsed.length);
const evoUnparsed = weapons.flatMap((w) =>
  (w.evolutions ?? []).flatMap((t: any) => t.options.filter((o: any) => o.unparsed?.length).map((o: any) => ({ weapon: w.name, tier: t.tier, name: o.name, unparsed: o.unparsed }))),
);
const evoTotal = weapons.reduce((n, w) => n + (w.evolutions ?? []).reduce((k: number, t: any) => k + t.options.length, 0), 0);
console.log(`evolutions: ${weapons.filter((w) => w.evolutions).length} weapons, ${evoTotal} options, ${evoUnparsed.length} with unmodelled damage effects`);
const bySlot = Object.entries(weapons.reduce((a: Record<string, number>, w) => ((a[w.slot] = (a[w.slot] ?? 0) + 1), a), {})).map(([k, v]) => `${v} ${k}`).join(", ");
console.log(`gamedata ${hash}: ${weapons.length} weapons (${bySlot}), ${modesN} attack modes, ${mods.length} mods, ${arcanes.length} arcanes, ${buffs.length} buffs`);
console.log(`unsupported modes: ${unsupported.length}; mods with unparsed effects: ${unparsedMods.length}`);
writeFileSync(join(root, "data/ingest-report.json"), JSON.stringify({ unsupported, unparsedMods: unparsedMods.map((m) => ({ name: m.name, unparsed: m.unparsed })), unparsedEvolutions: evoUnparsed, gunCo: gunCoReport }, null, 2));
