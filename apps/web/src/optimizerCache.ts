// Optimizer results that don't need a new search: builds this session already found (any option
// change back to a combination tried before), and the precomputed best builds when the settings are
// exactly the ones they were computed with.
import { compute, defaultConditions, defaultScenario, engineBuild, buildFromBest, targetKey, type Scenario } from "./store";
import type { BestBuilds, BestEntry, BestPair, GameData, OptimizeOptions, OptimizeResult, SeedBuild, Weapon } from "./types";
import type { Engine } from "./wasm/wf_wasm.js";

const MAX = 100;
const results = new Map<string, OptimizeResult>();

export function cachedResult(key: string): OptimizeResult | undefined {
  const r = results.get(key);
  if (r) {
    // Most recently used last.
    results.delete(key);
    results.set(key, r);
  }
  return r;
}

export function rememberResult(key: string, r: OptimizeResult) {
  results.set(key, r);
  while (results.size > MAX) results.delete(results.keys().next().value!);
}

const sorted = (o: object) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v != null).sort(([a], [b]) => a.localeCompare(b))));

/** The scenario the precompute used for this weapon and objective (companion group fights: Contagious Bond). */
function isPrecomputeScenario(s: Scenario, weapon: Weapon, objective: string): boolean {
  const d = defaultScenario();
  const want = { ...defaultConditions(), contagiousBond: weapon.slot === "companion" && objective === "group" };
  const have = { ...defaultConditions(), ...s.conditions };
  // With automatic status types the manual count doesn't matter.
  if (have.statusTypesAuto ?? true) {
    delete (have as Partial<typeof have>).statusTypes;
    delete (want as Partial<typeof want>).statusTypes;
  }
  return (
    sorted(have) === sorted(want) &&
    sorted({ ...d.target, enemy: s.target.enemy }) === sorted(s.target) &&
    s.strength === 1 &&
    Object.values(s.buffs).every((b) => !b.on)
  );
}

/** The precomputed build closest to these options: same target, riven or not, heavy or not, group or not. */
function precomputedEntry(best: BestBuilds, weapon: Weapon, scenario: Scenario, opts: OptimizeOptions): BestEntry | undefined {
  const heavy = weapon.modes.findIndex((m) => m.meleeRole === "heavy");
  const isHeavy = opts.mode != null && opts.mode === heavy;
  const group = opts.objective === "group";
  const riven = !!opts.riven || !!opts.fixedRiven?.length;
  const pair = best.targets[targetKey(scenario.target)]?.[weapon.id];
  const prefix = isHeavy ? (group ? "heavyGroup" : "heavy") : group ? "group" : "";
  const key = (prefix ? `${prefix}${riven ? "Riven" : "Plain"}` : riven ? "riven" : "plain") as keyof BestPair;
  const e = pair?.[key];
  return e && typeof e === "object" ? e : undefined;
}

/** A start for a search with other settings (locked mods, goals, another scenario): the precomputed
 * build for this weapon and target. The search still looks everywhere; this is one more start. */
export function seedFor(best: BestBuilds | undefined, weapon: Weapon, scenario: Scenario, opts: OptimizeOptions): SeedBuild | null {
  const e = best ? precomputedEntry(best, weapon, scenario, opts) : undefined;
  if (!e) return null;
  return {
    modeIndex: e.modeIndex,
    mods: e.mods,
    arcane: e.arcane,
    evolutions: e.evolutions ?? [],
    progenitor: e.progenitor ?? null,
    riven: opts.fixedRiven?.length ? [] : (e.riven ?? []).map((r) => r.key),
  };
}

/** The precomputed best build for these settings, if they match the precompute's exactly. */
export function precomputedResult(
  data: GameData,
  engine: Engine,
  best: BestBuilds | undefined,
  weapon: Weapon,
  scenario: Scenario,
  opts: OptimizeOptions,
): OptimizeResult | undefined {
  if (!best || best.dataVersion !== data.version) return undefined;
  const objective = opts.objective ?? "balanced";
  if (objective !== "balanced" && objective !== "group") return undefined;
  const defaults =
    !opts.maxFireRateBonus &&
    !opts.minAttackSpeed &&
    !opts.rangeTolerance &&
    !opts.capacity &&
    !opts.minCritChance &&
    !opts.fixedRiven?.length &&
    !opts.fixedEvolutions?.length &&
    !opts.fixedArcane &&
    !opts.goals?.length &&
    !opts.allowFaction &&
    opts.splicedRiven !== false &&
    opts.explosionMod !== false &&
    opts.arcane !== false;
  if (!defaults || !isPrecomputeScenario(scenario, weapon, objective)) return undefined;
  const heavy = weapon.modes.findIndex((m) => m.meleeRole === "heavy");
  if (opts.mode != null && opts.mode !== heavy) return undefined;
  const e = precomputedEntry(best, weapon, scenario, opts);
  if (!e) return undefined;
  // The best build overall is also the best one with these locked mods when it already has them.
  const lockedNames = (opts.lockedMods ?? []).map((k) => data.mods.find((m) => m.id === k || m.name === k)?.name ?? k);
  if (!lockedNames.every((n) => e.mods.includes(n))) return undefined;
  // The stats the result panel shows, from the engine with this scenario.
  const m = compute(engine, engineBuild(data, buildFromBest(data, weapon, e), scenario), scenario.target).ok?.modes.find((x) => x.modeIndex === e.modeIndex);
  return {
    weaponId: weapon.id,
    weapon: weapon.name,
    mode: weapon.modes[e.modeIndex]?.name ?? "",
    modeIndex: e.modeIndex,
    burstDps: m?.burstDps ?? e.burstDps,
    mods: e.mods,
    arcane: e.arcane,
    riven: e.riven ?? [],
    rivenNegative: e.rivenNegative ?? null,
    marginal: [],
    evaluations: 0,
    objective,
    score: 0,
    fireRate: m?.fireRate ?? 0,
    sustainedDps: m?.sustainedDps ?? e.sustainedDps ?? 0,
    perShot: m?.perShot ?? 0,
    perCharge: m?.perCharge ?? null,
    evolutions: e.evolutions ?? [],
    progenitor: e.progenitor ?? null,
    attackSpeed: m?.attackSpeed ?? null,
    rangeM: m?.rangeM ?? null,
    drain: null,
    rangeCost: null,
    belowAttackSpeedFloor: false,
    searchScore: 0,
    source: "precomputed",
  };
}
