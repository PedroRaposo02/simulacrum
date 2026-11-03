// Optimizer results that don't need a new search: builds this session already found (any option
// change back to a combination tried before), and the precomputed best builds when the settings are
// exactly the ones they were computed with.
import { compute, defaultConditions, defaultScenario, engineBuild, buildFromBest, targetKey, type Scenario } from "./store";
import type { BestBuilds, BestPair, GameData, OptimizeOptions, OptimizeResult, Weapon } from "./types";
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
    !opts.allowFaction &&
    opts.splicedRiven !== false &&
    opts.explosionMod !== false &&
    opts.arcane !== false;
  if (!defaults || !isPrecomputeScenario(scenario, weapon, objective)) return undefined;
  const heavy = weapon.modes.findIndex((m) => m.meleeRole === "heavy");
  const isHeavy = opts.mode != null && opts.mode === heavy;
  if (opts.mode != null && !isHeavy) return undefined;
  const pair = best.targets[targetKey(scenario.target)]?.[weapon.id];
  const prefix = isHeavy ? (objective === "group" ? "heavyGroup" : "heavy") : objective === "group" ? "group" : "";
  const key = (prefix ? `${prefix}${opts.riven ? "Riven" : "Plain"}` : opts.riven ? "riven" : "plain") as keyof BestPair;
  const e = pair?.[key];
  if (!e || typeof e !== "object") return undefined;
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
    source: "precomputed",
  };
}
