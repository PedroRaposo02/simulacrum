// Builds data/gamedata.json from @wfcd/items (MIT) plus data/overrides.
// First source of the pipeline; Public Export, public-export-plus and the wiki join later.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";



const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const wfcdDir = join(dirname(fileURLToPath(import.meta.url)), "../node_modules/@wfcd/items/data/json");
const wfcdVersion: string = JSON.parse(readFileSync(join(wfcdDir, "../../package.json"), "utf8")).version;
const load = (f: string) => JSON.parse(readFileSync(join(wfcdDir, f), "utf8"));
const override = (f: string) => JSON.parse(readFileSync(join(root, "data/overrides", f), "utf8"));

type Stat = { kind: string; of?: string };
type Modifier = { source: string; stat: Stat; value: number; maxStacks?: number; condition?: string };

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
const IRRELEVANT = /Punch Through|Recoil|Ammo Maximum|Ammo Pick Up|Projectile Speed|Zoom|Accuracy|Health Orbs|Minimap|Movement Speed|Holstered|Heal Rate|Shield Recharge|hear gunfire|Beam Range|Blast Range|Flight Speed|Holster|Chance to Explode|'\w+'|Ammo Efficiency|Spread|Sprint Speed|Dodge Speed|Revive Speed|Combo Count|Life Steal|Mobility|Slide/i;

function statOf(name: string): Stat | null {
  name = name.trim().replace(/\s*\(x2 for Bows\)/, "");
  if (name === "Damage" || name === "Direct Damage") return { kind: "baseDamage" };
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
};

/** Parse one stat line into modifiers; returns null when it can't be read. */
function parseLine(source: string, raw: string): Modifier[] | null {
  const line = raw.replace(/<[^>]+>/g, "").replace(/\\n/g, "\n").trim();
  const faction = line.match(/^x([\d.]+) Damage to (\w+)$/);
  if (faction && FACTIONS[faction[2]]) {
    return [{ source, stat: { kind: "factionDamage", of: FACTIONS[faction[2]] }, value: +faction[1] - 1 }];
  }
  const cond = line.match(/^(On [\w ]+?):\s*\n?([\s\S]+)$/);
  if (cond) {
    const condition = CONDITIONS[cond[1]];
    const body = cond[2].trim().match(/^([+-][\d.]+)% ([A-Za-z ]+?)(?: when Aiming)?(?: for [\d.]+s)?\.?(?: Stacks up to (\d+)x\.?)?$/);
    if (!condition || !body) return null;
    const stat = statOf(body[2]);
    if (!stat) return IRRELEVANT.test(body[2]) ? [] : null;
    return [{ source: `${source} (${cond[1].toLowerCase()})`, stat, value: +body[1] / 100, maxStacks: body[3] ? +body[3] : 1, condition }];
  }
  const plain = line.match(/^([+-][\d.]+)% (.+)$/);
  if (plain) {
    const stat = statOf(plain[2]);
    if (stat) return [{ source, stat, value: +plain[1] / 100 }];
  }
  return IRRELEVANT.test(line) ? [] : null;
}

const POOLS: Record<string, string> = {
  "Primary Mod": "primary", "Shotgun Mod": "shotgun", "Secondary Mod": "secondary", "Arch-Gun Mod": "archGun",
};
const GENERIC_COMPAT = new Set(["primary", "unique", "rifle", "pistol", "shotgun", "archgun", "thrown", "rifle (no aoe)", "pistol (no aoe)"]);

const exclusivity: string[][] = override("mod-exclusivity.json").groups;
function exclusiveGroup(name: string, pool: string): string | undefined {
  const g = exclusivity.find((grp) => grp.includes(name));
  if (g) return `${pool}:${g[0]}`;
  const stem = name.replace(/^(Primed|Amalgam|Umbral|Sacrificial) /, "");
  return `${pool}:${stem}`;
}

function buildMods() {
  const mods = (load("Mods.json") as any[]).filter((m) => POOLS[m.type] && m.levelStats?.length);
  const out = mods.map((m) => {
    const pool = POOLS[m.type];
    const compatRaw = String(m.compatName ?? "").toLowerCase();
    const compat = GENERIC_COMPAT.has(compatRaw) || !compatRaw ? null : compatRaw;
    const modifiers: Modifier[] = [];
    const unparsed: string[] = [];
    for (const line of m.levelStats.at(-1).stats as string[]) {
      for (const part of line.split(/\n(?=On )|\\n(?=On )/)) {
        const r = parseLine(m.name, part);
        if (r) modifiers.push(...r);
        else unparsed.push(part.replace(/<[^>]+>/g, "").replace(/\\n/g, " "));
      }
    }
    return {
      id: m.uniqueName, name: m.name, pool, compat, polarity: m.polarity ?? "", baseDrain: m.baseDrain ?? 0,
      maxRank: m.fusionLimit ?? 0, isExilus: !!m.isExilus, exclusiveGroup: exclusiveGroup(m.name, pool),
      modifiers, unparsed,
    };
  });
  // Same name can appear several times (beginner, PvP variants); keep the full version.
  // "Expert" paths are primed variants; under an unprimed name they are unreleased placeholders.
  const rank = (m: { id: string; name: string; maxRank: number }) =>
    (/Beginner|PvP|Conclave/i.test(m.id) ? -100 : 0) + (/Expert/.test(m.id) && !/^Primed /.test(m.name) ? -50 : 0) + m.maxRank;
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
  const behaviours: Record<string, string> = override("arcanes.json").behaviours;
  return (load("Arcanes.json") as any[])
    .filter((a) => /^(Primary|Secondary) Arcane$/.test(a.type) && a.levelStats?.length)
    .map((a) => {
      const first = String(a.levelStats.at(-1).stats[0] ?? "").replace(/<[^>]+>/g, "");
      const segs = first.split(/\\n|\n/).map((s) => s.trim()).filter(Boolean);
      const modifiers: Modifier[] = [];
      if (!behaviours[a.name]) {
        let i = 0;
        if (segs[0]?.endsWith(":") && segs[1]) {
          modifiers.push(...(parseLine(a.name, `${segs[0]}\n${segs[1]}`) ?? []));
          i = 2;
        }
        for (const s of segs.slice(i)) modifiers.push(...(parseLine(a.name, s) ?? []));
      }
      return {
        id: a.uniqueName, name: a.name, slot: a.type.startsWith("Primary") ? "primary" : "secondary",
        behaviour: behaviours[a.name] ?? null, modifiers, description: segs.join(" "),
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
const SLOT: Record<string, string> = { Primary: "primary", Secondary: "secondary", "Arch-Gun": "archGun", SentinelWeapons: "companion" };

const FAMILY_AFFIXES = /^(Kuva|Tenet|Coda|Prisma|Mara|Dex|Synoid|Telos|Sancti|Rakta|Secura|Vaykor|Carmine|Ak|Twin|Mk1-) | (Prime|Vandal|Wraith|Prisma)$/g;

const incarnon: Record<string, { rounds?: number; rechargeS?: number }> = override("incarnon.json").weapons;

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

function buildWeapon(w: any, slotFile: string) {
  const multishot = w.multishot ?? 1;
  const modes: any[] = [];
  const tags = new Set<string>();
  for (const a of w.attacks ?? []) {
    const isIncarnon = /Incarnon/i.test(a.name);
    const comp = {
      name: a.name, kind: kindOf(a), damage: damageMap(a.damage),
      critChance: (a.crit_chance ?? 0) / 100, critMult: a.crit_mult ?? 1, statusChance: (a.status_chance ?? 0) / 100,
      multishot, ...(a.falloff ? { falloff: { startM: a.falloff.start, endM: a.falloff.end, reduction: a.falloff.reduction ?? 0 } } : {}),
      rules: { canHeadshot: kindOf(a) !== "radial", receivesMultishot: true },
    };
    const prev = modes.at(-1);
    const sameRate = prev && (a.speed == null || prev.fireRate === a.speed || prev.chargeTimeS === a.charge_time);
    if (comp.kind === "radial" && prev && sameRate) {
      if (prev.components[0].kind !== "radial" && /hit-?scan/i.test(prev.shotType)) comp.rules.receivesMultishot = false;
      prev.components.push(comp);
      tags.add("radialChild");
      continue;
    }
    const notes: string[] = [];
    if (a.falloff) notes.push(`Damage falloff ignored (assumes ${comp.kind === "radial" ? "blast centre" : "point blank"})`);
    if (w.trigger?.includes("Burst")) notes.push("Burst delay not modelled; listed fire rate used");
    if (/Kuva|Tenet/.test(w.name)) { notes.push("Progenitor bonus element not included"); tags.add("progenitor"); }
    const inc = incarnon[w.name];
    const hasDamage = Object.keys(comp.damage).length > 0;
    const hasRate = (a.speed ?? 0) > 0 || (a.charge_time ?? 0) > 0;
    const eventTriggered = /Reload|On Kill|Death/i.test(a.name);
    if (isIncarnon) tags.add("incarnon");
    if (a.charge_time) tags.add("charge");
    modes.push({
      name: a.name, shotType: a.shot_type ?? "",
      trigger: a.charge_time ? "charge" : TRIGGER[w.trigger] ?? "other",
      fireRate: a.speed ?? 0, magazine: isIncarnon ? null : w.magazineSize ?? null, reloadS: w.reloadTime ?? 0,
      ...(a.charge_time ? { chargeTimeS: a.charge_time } : {}),
      ammoPool: isIncarnon ? { kind: "incarnon", rounds: inc?.rounds ?? null, recharge_s: inc?.rechargeS ?? null } : { kind: "magazine" },
      components: [comp],
      coverage: hasDamage && hasRate && !eventTriggered ? "computed" : "unsupported",
      notes: eventTriggered
        ? ["Triggered by an event (reload, kill, explosion), not by firing; event attacks not modelled yet"]
        : hasDamage && hasRate ? notes : [hasDamage ? "No fire rate or charge time in source data" : "No damage in source data"],
    });
  }
  for (const m of modes) delete m.shotType;
  return {
    id: w.uniqueName, name: w.name, slot: SLOT[slotFile], class: CLASS[w.type] ?? "rifle",
    family: w.name.replace(FAMILY_AFFIXES, "").trim(), modes, innate: [], mechanicTags: [...tags],
    image: w.imageName ? `https://cdn.warframestat.us/img/${w.imageName}` : undefined,
    sources: { base: "wfcd", attacks: "wfcd (wiki-derived)" },
  };
}

function buildWeapons() {
  const files: [string, string][] = [["Primary", "Primary.json"], ["Secondary", "Secondary.json"], ["Arch-Gun", "Arch-Gun.json"], ["SentinelWeapons", "SentinelWeapons.json"]];
  const out: any[] = [];
  for (const [slot, f] of files) {
    for (const w of load(f) as any[]) {
      if (!w.attacks?.length || w.uniqueName.includes("/PvPVariant")) continue;
      if (slot === "Primary" && w.type === "Pistol") w.type = "Rifle";
      out.push(buildWeapon(w, slot));
    }
  }
  const seen = new Set<string>();
  return out.filter((w) => !seen.has(w.name) && seen.add(w.name));
}

const weapons = buildWeapons();
const mods = buildMods();
const arcanes = buildArcanes();
const enemies = override("enemies.json").enemies;
const body = { weapons, mods, arcanes, enemies };
const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
const gamedata = {
  version: hash, generatedAt: new Date().toISOString(),
  sources: { wfcd: `@wfcd/items ${wfcdVersion} (MIT)`, overrides: "data/overrides" },
  ...body,
};

const outPath = join(root, "data/gamedata.json");
writeFileSync(outPath, JSON.stringify(gamedata));
mkdirSync(join(root, "apps/web/public"), { recursive: true });
copyFileSync(outPath, join(root, "apps/web/public/gamedata.json"));

const modesN = weapons.reduce((n, w) => n + w.modes.length, 0);
const unsupported = weapons.flatMap((w) => w.modes.filter((m: any) => m.coverage === "unsupported").map((m: any) => `${w.name} / ${m.name}`));
const unparsedMods = mods.filter((m) => m.unparsed.length);
console.log(`gamedata ${hash}: ${weapons.length} weapons, ${modesN} attack modes, ${mods.length} mods, ${arcanes.length} arcanes`);
console.log(`unsupported modes: ${unsupported.length}; mods with unparsed effects: ${unparsedMods.length}`);
writeFileSync(join(root, "data/ingest-report.json"), JSON.stringify({ unsupported, unparsedMods: unparsedMods.map((m) => ({ name: m.name, unparsed: m.unparsed })) }, null, 2));
