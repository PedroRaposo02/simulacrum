// Melee attack modes from wiki data: one light mode per stance combo, plus heavy and Tennokai modes.
import { wikiJson } from "./fetch-wiki.ts";

type DamageMap = Record<string, number>;

const COMBO_INPUTS = ["Neutral", "Forward", "Block", "Forward Block"];

let wikiMelee: Record<string, any> | null = null;
let wikiStances: Record<string, any> | null = null;

function load() {
  wikiMelee ??= wikiJson("melee.json");
  wikiStances ??= wikiJson("stances.json");
}

export function wikiMeleeEntry(uniqueName: string, name: string): any | undefined {
  load();
  return Object.values(wikiMelee!).find((w: any) => w.InternalName === uniqueName) ?? wikiMelee![name];
}

/** Stances usable by a weapon: same weapon type, not Conclave-only; weapon-unique stances only for that weapon. */
export function stancesFor(entry: any): any[] {
  load();
  return Object.values(wikiStances!).filter((s: any) => {
    if (!s || s.StanceName === "__Legend" || s.ConclaveOnly) return false;
    if (!COMBO_INPUTS.some((k) => s[k]?.Attacks?.length && s[k]?.Duration)) return false;
    if (s.UniqueToWeapon) return s.StanceName === entry.Name || entry.Name?.startsWith(s.StanceName);
    return s.WeaponType === entry.Class;
  });
}

const arr = (v: any) => (Array.isArray(v) ? v : v == null ? [] : [v]);

function scaled(base: DamageMap, mult: number, typeMults: Record<string, number>): DamageMap {
  const out: DamageMap = {};
  for (const [t, v] of Object.entries(base)) out[t] = v * mult * (typeMults[t] ?? 1);
  return out;
}

interface NormalAttack {
  damage: DamageMap;
  critChance: number;
  critMult: number;
  statusChance: number;
}

const COMMON_NOTES = [
  "Light attacks aren't multiplied by combo; combo only scales combo-based mods (Blood Rush, Weeping Wounds)",
];

export function meleeModes(entry: any, normal: NormalAttack, attackSpeed: number) {
  const modes: any[] = [];
  const stances = stancesFor(entry);
  for (const s of stances) {
    for (const input of COMBO_INPUTS) {
      const combo = s[input];
      if (!combo?.Attacks?.length || !combo.Duration) continue;
      const components: any[] = [];
      let n = 0;
      for (const atk of combo.Attacks) {
        const dmg = arr(atk.Dmg);
        const hits = arr(atk.Hits);
        dmg.forEach((d: number, j: number) => {
          n++;
          // 0% steps (movement, parries) deal nothing; their time is already in the combo duration.
          if (!(d > 0)) return;
          const typeMults: Record<string, number> = {};
          if (atk.SlashMultiplier) typeMults.slash = arr(atk.SlashMultiplier)[j] ?? 1;
          if (atk.PunctureMultiplier) typeMults.puncture = arr(atk.PunctureMultiplier)[j] ?? 1;
          if (atk.ImpactMultiplier) typeMults.impact = arr(atk.ImpactMultiplier)[j] ?? 1;
          const statusMult = arr(atk.StatusMultiplier)[j] ?? 1;
          const procs = arr(arr(atk.Procs)[j]).filter(Boolean);
          // Forced procs that deal damage: Bleed is a Slash proc, Tesla Chain an Electricity proc.
          const forcedProcs = procs.flatMap((pr: string) => (/^(Bleed|Slash)$/.test(pr) ? ["slash"] : /^Tesla Chain$/.test(pr) ? ["electricity"] : []));
          components.push({
            name: `Hit ${n} (${d}%${hits[j] > 1 ? ` ×${hits[j]}` : ""}${procs.length ? `, ${procs.join("/")}` : ""})`,
            kind: "melee",
            damage: scaled(normal.damage, d / 100, typeMults),
            critChance: normal.critChance,
            critMult: normal.critMult,
            statusChance: normal.statusChance * statusMult,
            multishot: hits[j] ?? 1,
            rules: { canHeadshot: true, receivesMultishot: true },
            ...(forcedProcs.length ? { forcedProcs } : {}),
          });
        });
      }
      // Forced procs without a damage model here (Puncture, Impact, Heat…): flagged on the mode.
      const forced = combo.Attacks.flatMap((a: any) => arr(a.Procs).flat()).filter((p: string) => p && /^(Impact|Puncture|Heat|Toxin|Viral|Corrosive)$/i.test(p));
      modes.push({
        name: `${s.StanceName}: ${combo.Name} (${input})`,
        trigger: "other",
        // Combos per second at the weapon's base attack speed; wiki durations are taken as measured at 1.0.
        fireRate: attackSpeed / combo.Duration,
        magazine: null,
        reloadS: 0,
        ammoPool: { kind: "none" },
        components,
        coverage: "computed",
        notes: [
          `Stance combo: ${combo.Duration}s at 1.0 attack speed (wiki); duration scales with attack speed`,
          ...(forced.length ? [`Forced ${[...new Set(forced)].join("/")} procs in this combo aren't counted`] : []),
          ...COMMON_NOTES,
        ],
        meleeRole: "light",
        stance: s.StanceName,
      });
    }
  }

  const total = Object.values(normal.damage).reduce((a, b) => a + b, 0);
  if (entry.HeavyAttack && total > 0) {
    const heavyDamage = scaled(normal.damage, entry.HeavyAttack / total, {});
    const wind = entry.WindUp ?? 1;
    const base = {
      kind: "melee",
      damage: heavyDamage,
      critChance: normal.critChance,
      critMult: normal.critMult,
      statusChance: normal.statusChance,
      multishot: 1,
    };
    modes.push({
      name: "Heavy Attack",
      trigger: "other",
      fireRate: 1 / wind,
      magazine: null,
      reloadS: 0,
      ammoPool: { kind: "none" },
      components: [{ ...base, name: "Heavy Attack", rules: { canHeadshot: true, receivesMultishot: true, comboScaling: true, heavy: true } }],
      coverage: "computed",
      notes: [`Heavy attack: ${entry.HeavyAttack} damage, ${wind}s wind-up; DPS counts wind-up only and assumes the heavy combo every swing`],
      headline: false,
      meleeRole: "heavy",
    });
    modes.push({
      name: "Tennokai (heavy at light-build combo)",
      trigger: "other",
      fireRate: 1 / wind,
      magazine: null,
      reloadS: 0,
      ammoPool: { kind: "none" },
      components: [
        { ...base, name: "Tennokai", rules: { canHeadshot: true, receivesMultishot: true, comboScaling: true, heavy: true, tennokai: true } },
      ],
      coverage: "computed",
      notes: [
        "Tennokai: a heavy attack during the 2s window opened by a 15% chance per melee hit; doesn't consume combo. Needs a Tennokai mod equipped",
        "Per-hit damage is the useful number; DPS assumes back-to-back Tennokai",
      ],
      headline: false,
      meleeRole: "tennokai",
    });
  }
  return { modes, stances: stances.map((s) => s.StanceName) };
}
