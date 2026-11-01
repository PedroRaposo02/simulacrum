// Builds data/gamedata.json from @wfcd/items (MIT) plus data/overrides.
// First source of the pipeline; Public Export, public-export-plus and the wiki join later.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWiki, wikiJson } from "./fetch-wiki.ts";
import { meleeModes, wikiMeleeEntry } from "./melee.ts";

await fetchWiki();

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const wfcdDir = join(dirname(fileURLToPath(import.meta.url)), "../node_modules/@wfcd/items/data/json");
const wfcdVersion: string = JSON.parse(readFileSync(join(wfcdDir, "../../package.json"), "utf8")).version;
const load = (f: string) => JSON.parse(readFileSync(join(wfcdDir, f), "utf8"));
const override = (f: string) => JSON.parse(readFileSync(join(root, "data/overrides", f), "utf8"));

type Stat = { kind: string; of?: string };
type Modifier = { source: string; stat: Stat; value: number; maxStacks?: number; condition?: string; per?: string; appliesTo?: string };

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

function statOf(name: string): Stat | null {
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

/** Parse one stat line into modifiers; returns null when it can't be read. */
function parseLine(source: string, raw: string): Modifier[] | null {
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
  const mods = (load("Mods.json") as any[]).filter((m) => POOLS[m.type] && (m.levelStats?.length || /Enables Tennokai/i.test(m.description ?? "")));
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
      maxRank: m.fusionLimit ?? 0, isExilus: !!m.isExilus, exclusiveGroup: exclusiveGroup(m.name, pool),
      modifiers, ...(requiresTrigger ? { requiresTrigger } : {}), ...(locksFireRate ? { locksFireRate } : {}), ...(enablesTennokai ? { enablesTennokai } : {}), unparsed,
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
for (const file of ["primary.json", "secondary.json"]) {
  for (const w of Object.values(wikiJson(file)) as any[]) {
    const atk = (w?.Attacks ?? []).find((a: any) => a?.IncarnonCharges);
    if (w?.InternalName && atk) wikiIncarnonRounds.set(w.InternalName, atk.IncarnonCharges);
  }
}

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
  const isMelee = slotFile === "Melee";
  const multishot = w.multishot ?? 1;
  const modes: any[] = [];
  const tags = new Set<string>();
  for (const a of w.attacks ?? []) {
    const isIncarnon = /Incarnon/i.test(a.name);
    const comp = {
      name: a.name, kind: kindOf(a), damage: damageMap(a.damage),
      critChance: (a.crit_chance ?? 0) / 100, critMult: a.crit_mult ?? 1, statusChance: (a.status_chance ?? 0) / 100,
      multishot, ...(a.falloff ? { falloff: { startM: a.falloff.start, endM: a.falloff.end, reduction: a.falloff.reduction ?? 0 } } : {}),
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
        ? { kind: "incarnon", rounds: inc?.rounds ?? wikiIncarnonRounds.get(w.uniqueName) ?? null, recharge_s: inc?.rechargeS ?? null }
        : isMelee ? { kind: "none" } : { kind: "magazine" },
      ...(isIncarnon ? { incarnonForm: true } : {}),
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
  return {
    id: w.uniqueName, name: w.name, slot, class: cls, modPool: modPoolOf(slot, cls, w.uniqueName),
    family: w.name.replace(FAMILY_AFFIXES, "").trim(), modes, innate: [], mechanicTags: [...tags],
    image: w.imageName ? `https://cdn.warframestat.us/img/${w.imageName}` : undefined,
    ...(melee ? { melee } : {}),
    ...(incarnon[w.name]?.evolutions ? { evolutions: incarnon[w.name].evolutions } : {}),
    sources: { base: "wfcd", attacks: "wfcd (wiki-derived)", ...(melee ? { melee: "wiki Module:Weapons/data/melee + Module:Stances/data" } : {}) },
  };
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
      if (slot === "Melee" && w.type !== "Melee") continue;
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
const { _note: _rivenNote, source: _rivenSource, readOn: _rivenReadOn, ...riven } = override("riven.json");
const buffs = override("buffs.json").buffs;
const body = { weapons, mods, arcanes, enemies, riven, buffs };
const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
const gamedata = {
  version: hash, generatedAt: new Date().toISOString(),
  sources: {
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
const bySlot = Object.entries(weapons.reduce((a: Record<string, number>, w) => ((a[w.slot] = (a[w.slot] ?? 0) + 1), a), {})).map(([k, v]) => `${v} ${k}`).join(", ");
console.log(`gamedata ${hash}: ${weapons.length} weapons (${bySlot}), ${modesN} attack modes, ${mods.length} mods, ${arcanes.length} arcanes, ${buffs.length} buffs`);
console.log(`unsupported modes: ${unsupported.length}; mods with unparsed effects: ${unparsedMods.length}`);
writeFileSync(join(root, "data/ingest-report.json"), JSON.stringify({ unsupported, unparsedMods: unparsedMods.map((m) => ({ name: m.name, unparsed: m.unparsed })) }, null, 2));
