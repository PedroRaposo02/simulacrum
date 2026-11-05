import { useEffect, useMemo, useRef, useState } from "react";
import { readSetting, usePersistent, writeSetting } from "./persist";
import { emptyRiven, rivenModifiers } from "./riven";
import { buildFromBest, cancelSearch, compute, engineBuild, fmt, optimizeInWorker, pct, scenarioBuild, SLOT_COUNT, useStore } from "./store";
import { Toggle } from "./Common";
import { cachedResult, precomputedResult, rememberResult, seedFor } from "./optimizerCache";
import type { EditorBuild, GoalStat, ModeResult, Objective, OptimizeOptions, OptimizeResult, StatGoal, Weapon } from "./types";

const OBJECTIVES: [Objective, string, string][] = [
  ["balanced", "Balanced (recommended)", "Sustained DPS where fire rate past +150% over the weapon's base adds nothing: slots go to damage and status"],
  ["burst", "Burst DPS", "Damage per second while firing, ignoring reloads"],
  ["sustained", "Sustained DPS", "Includes reloads"],
  ["perShot", "Damage per shot / combo", "Ignores fire rate entirely"],
  ["perCharge", "Damage per magazine / Incarnon charge", "Fire rate adds nothing: favours damage stats"],
  ["group", "Group fight", "Balanced, on the damage to a whole group (Scenario › Conditions › group size): explosions, melee swings, Gas, Electricity, Blast and Melee Influence"],
];

interface GoalDef {
  stat: GoalStat;
  label: string;
  /** Unit of the absolute value; "%" values are fractions shown as percentages. */
  unit: string;
  atMost?: boolean;
  melee?: boolean;
  gun?: boolean;
  of: (m: ModeResult) => number;
}

const maxOf = (m: ModeResult, f: (c: ModeResult["components"][number]) => number) => Math.max(0, ...m.components.map(f));

export function goalDefs(melee: boolean): GoalDef[] {
  const all: GoalDef[] = [
    { stat: "fireRate", label: melee ? "Attack speed" : "Fire rate", unit: melee ? "×" : "/s", of: (m) => m.attackSpeed ?? m.fireRate },
    { stat: "critChance", label: "Critical chance", unit: "%", of: (m) => maxOf(m, (c) => c.arsenalCritChance) },
    { stat: "critMultiplier", label: "Critical multiplier", unit: "×", of: (m) => maxOf(m, (c) => c.arsenalCritMult) },
    { stat: "statusChance", label: "Status chance", unit: "%", of: (m) => maxOf(m, (c) => c.statusChance) },
    { stat: "multishot", label: "Projectiles per shot", unit: "", gun: true, of: (m) => maxOf(m, (c) => c.projectiles) },
    { stat: "magazine", label: "Magazine", unit: "rounds", gun: true, of: (m) => m.magazine ?? 0 },
    { stat: "reloadTime", label: "Reload time", unit: "s", atMost: true, gun: true, of: (m) => m.reloadS },
    { stat: "range", label: "Range", unit: "m", melee: true, of: (m) => m.rangeM ?? 0 },
  ];
  return all.filter((d) => (melee ? !d.gun : !d.melee));
}

export const goalValue = (d: GoalDef, v: number) =>
  d.unit === "%"
    ? `${(v * 100).toFixed(1)}%`
    : d.unit === "×"
      ? `${v.toFixed(2)}×`
      : d.unit === "/s"
        ? `${v.toFixed(2)}/s`
        : `${+v.toFixed(2)}${d.unit ? ` ${d.unit}` : ""}`;

const POLARITIES = ["madurai", "vazarin", "naramon", "zenurik", "unairu", "penjaga", "umbra"];

export interface ComfortSettings {
  on: boolean;
  /** Melee: attack speed floor. */
  minAttackSpeed: number;
  /** Melee: accept a range mod up to this DPS cost. */
  rangeTolerance: number;
  /** Guns: max fire-rate bonus over the unmodded rate (1.5 = +150%), so the magazine doesn't empty instantly. */
  maxFireRateBonus: number;
}

export interface OptimizerState {
  result: OptimizeResult;
  previous: EditorBuild;
  label: string;
}

export default function OptimizerControls({
  weapon,
  comfort,
  setComfort,
  onResult,
}: {
  weapon: Weapon;
  comfort: ComfortSettings;
  setComfort: (c: ComfortSettings) => void;
  onResult: (s: OptimizerState) => void;
}) {
  const { data, engine, best, build, setBuild, scenario, search, setSearch } = useStore();
  const busy = search?.label ?? null;
  // Each search gets a number; a newer one cancels the older, whose result is then ignored.
  const generation = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<number | "auto">("auto");
  const [realistic, setRealistic] = usePersistent("opt.realistic", false);
  const [capacity, setCapacity] = usePersistent("opt.capacity", 60);
  const [polarities, setPolarities] = useState<(string | null)[]>(Array(SLOT_COUNT + 1).fill(null));
  const [grade, setGrade] = useState<{ ratio: number; god: number; mine: number } | null>(null);
  const [allowFaction, setAllowFaction] = usePersistent("opt.allowFaction", false);
  const [objective, setObjective] = usePersistent<Objective>("opt.objective", "balanced");
  const isCompanion = weapon.slot === "companion";
  const [tenacious, setTenacious] = usePersistent("opt.tenacious", false);
  const [spliced, setSpliced] = usePersistent("opt.spliced", true);
  const [explosionMod, setExplosionMod] = usePersistent("opt.explosionMod", true);
  const [keepEvolutions, setKeepEvolutions] = usePersistent("opt.keepEvolutions", false);
  const [keepArcane, setKeepArcane] = usePersistent("opt.keepArcane", false);
  const hasEvolutions = (weapon.evolutions ?? []).length > 0;
  // Stat goals belong to the weapon (15 shots/s means nothing on another gun).
  const goalsKey = `opt.goals.${weapon.id}`;
  const [goals, setGoalsState] = useState<StatGoal[]>(() => readSetting(goalsKey, []));
  useEffect(() => setGoalsState(readSetting(goalsKey, [])), [goalsKey]);
  const setGoals = (g: StatGoal[]) => {
    setGoalsState(g);
    writeSetting(goalsKey, g);
  };
  const lockedIds = (build.locked ?? []).filter((id) => build.slots.includes(id));
  const lockedNames = lockedIds.map((id) => data!.mods.find((m) => m.id === id)?.name ?? id);
  // The last optimizer action, re-run whenever an option changes.
  const last = useRef<{ label: string; extra: OptimizeOptions; previous: EditorBuild } | null>(null);

  const isMelee = !!weapon.melee;
  const heavyIndex = weapon.modes.findIndex((m) => m.meleeRole === "heavy");

  const options = (extra: OptimizeOptions): OptimizeOptions => ({
    objective,
    splicedRiven: spliced,
    mode: mode === "auto" ? null : mode,
    minAttackSpeed: comfort.on && isMelee ? comfort.minAttackSpeed : null,
    maxFireRateBonus: comfort.on && !isMelee ? comfort.maxFireRateBonus : null,
    explosionMod,
    minCritChance: isCompanion && tenacious ? 0.5 : null,
    rangeTolerance: comfort.on && isMelee ? comfort.rangeTolerance : null,
    capacity: realistic ? { capacity, polarities, rivenDrain: 9 } : null,
    allowFaction,
    fixedEvolutions: keepEvolutions && hasEvolutions ? build.evolutions.filter(Boolean) : [],
    fixedArcane: keepArcane ? build.arcane : null,
    lockedMods: lockedIds,
    goals: goals.filter((g) => isFinite(g.value) && (g.relative || g.value > 0)),
    ...extra,
  });

  // `instant`: the precomputed best build may answer (not for grading, which compares search scores).
  const run = async (label: string, extra: OptimizeOptions, instant = true) => {
    const opts = options(extra);
    const base = scenarioBuild(data!, scenario);
    // Same weapon, scenario and options as an earlier search (or the precompute's): no new search.
    const key = JSON.stringify([weapon.id, data!.version, base, scenario.target, opts]);
    const known = cachedResult(key) ?? (instant ? precomputedResult(data!, engine!, best, weapon, scenario, opts) : undefined);
    if (known) {
      if (useStore.getState().search) {
        cancelSearch();
        setSearch(null);
      }
      generation.current++;
      setError(null);
      return { ...known, source: known.source ?? "remembered" };
    }
    if (useStore.getState().search) cancelSearch();
    const mine = ++generation.current;
    setSearch({ label, started: Date.now() });
    setError(null);
    // The precomputed build is one more start for the search (not part of the remembered key).
    const r = await optimizeInWorker(weapon.id, base, scenario.target, { ...opts, seed: seedFor(best, weapon, scenario, opts) });
    if (mine !== generation.current) return null;
    setSearch(null);
    if (r.error?.code === "cancelled") return null;
    if (r.ok) rememberResult(key, r.ok);
    if (!r.ok) {
      setError(r.error?.message ?? "optimizer failed");
      return null;
    }
    return r.ok;
  };

  const apply = async (label: string, extra: OptimizeOptions, rerun = false) => {
    const r = await run(label, extra);
    if (!r) return;
    // A re-run after an option change keeps "undo" pointing at the build from before the first run.
    const previous = rerun && last.current ? last.current.previous : build;
    last.current = { label, extra, previous };
    const next = { ...buildFromBest(data!, weapon, r), locked: build.locked };
    // A fixed (graded) riven keeps the user's own rolls.
    if (extra.fixedRiven?.length) next.riven = build.riven;
    setBuild(next);
    onResult({ result: r, previous, label });
  };

  const gradeRiven = async () => {
    const mine = rivenModifiers(data!, build.riven, weapon.modPool);
    if (!mine.length) {
      setError("Add riven stats first.");
      return;
    }
    const god = await run("grade", { riven: true }, false);
    const own = await run("grade", { fixedRiven: mine }, false);
    if (god && own) setGrade({ ratio: own.score / god.score, god: god.score, mine: own.score });
  };

  // Options change the build: re-run the last optimizer action (debounced for number inputs).
  // The scenario too: outsourced Viral, buffs or a new enemy change which build and riven win.
  const optionsKey = JSON.stringify([objective, spliced, explosionMod, mode, comfort, tenacious, realistic, capacity, polarities, allowFaction, scenario, keepEvolutions, keepArcane, goals, lockedIds]);
  const firstKey = useRef(optionsKey);
  useEffect(() => {
    if (optionsKey === firstKey.current || !last.current) return;
    const t = setTimeout(() => {
      if (last.current) apply(last.current.label, last.current.extra, true);
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey]);
  // A different weapon starts fresh (and stops a search for the old one).
  useEffect(() => {
    last.current = null;
    if (useStore.getState().search) {
      generation.current++;
      cancelSearch();
      setSearch(null);
    }
  }, [weapon.id, setSearch]);

  const btn = "rounded-md px-3 py-1.5 text-sm text-white disabled:opacity-60";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button disabled={!!busy} onClick={() => apply("Most DPS Build", {})} className={`${btn} bg-indigo-600 hover:bg-indigo-500`}>
          {busy === "Most DPS Build" ? "Searching…" : "Most DPS Build"}
        </button>
        <button disabled={!!busy} onClick={() => apply("Most DPS Build + riven", { riven: true })} className={`${btn} bg-fuchsia-600 hover:bg-fuchsia-500`}>
          {busy === "Most DPS Build + riven" ? "Searching…" : "Most DPS + riven"}
        </button>
        {isMelee && heavyIndex >= 0 && (
          <button
            disabled={!!busy}
            onClick={() => apply("Heavy attack build", { mode: heavyIndex })}
            className={`${btn} bg-amber-600 hover:bg-amber-500`}
            title={`Optimizes the heavy attack at ${scenario.conditions.heavyComboMultiplier}× combo (Scenario > Conditions)`}
          >
            {busy === "Heavy attack build" ? "Searching…" : "Heavy build"}
          </button>
        )}
      </div>

      <details className="rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800">
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-zinc-500">Optimizer options</summary>
        <div className="mt-2 space-y-3">
          <p className="text-[11px] text-zinc-500">Changing an option or the scenario re-runs the last search and updates the build.</p>
          <div>
            <label className="label">Optimize for</label>
            <select className="field" value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
              {OBJECTIVES.map(([v, l, hint]) => (
                <option key={v} value={v} title={hint}>
                  {l}
                </option>
              ))}
            </select>
            <p className="mt-0.5 text-[11px] text-zinc-500">{OBJECTIVES.find((o) => o[0] === objective)?.[2]}</p>
          </div>
          <div>
            <label className="label">Attack mode</label>
            <select className="field" value={mode} onChange={(e) => setMode(e.target.value === "auto" ? "auto" : Number(e.target.value))}>
              <option value="auto">Auto (best of the top combos / modes)</option>
              {weapon.modes.map((m, i) => (
                <option key={i} value={i}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <GoalEditor weapon={weapon} goals={goals} setGoals={setGoals} mode={mode} />

          <Toggle
            label="Allow faction mods (Bane, Expel, Smite…) and riven faction stats"
            checked={allowFaction}
            onChange={setAllowFaction}
          />

          <Toggle label="Allow spliced riven stats (Viral, Corrosive…; one per riven)" checked={spliced} onChange={setSpliced} />
          {!isMelee && (
            <Toggle
              label="Explosion radius mod on explosive weapons (Primed Firestorm…)"
              checked={explosionMod}
              onChange={setExplosionMod}
              title="Slotted when the weapon's main fire mode is a sizeable explosion (Torid, Tonkor, Bramma). It adds no single-target damage; turn it off to let the optimizer fill that slot."
            />
          )}
          {isCompanion && (
            <Toggle
              label="Reach the Tenacious Bond threshold (companion crit chance ≥ 50%)"
              checked={tenacious}
              onChange={setTenacious}
              title="Tenacious Bond gives your own weapons +1.2x final crit multiplier while the companion's crit chance is at least 50%"
            />
          )}

          <Toggle
            label={isMelee ? "Comfortable build (attack speed floor, range if cheap)" : "Comfortable build (fire rate cap)"}
            checked={comfort.on}
            onChange={(on) => setComfort({ ...comfort, on })}
          />
          {comfort.on && (
            <div className="grid grid-cols-2 gap-2">
              {isMelee ? (
                <label className="text-xs text-zinc-500">
                  Min attack speed
                  <input
                    type="number"
                    step={0.05}
                    className="field mt-1"
                    value={comfort.minAttackSpeed}
                    onChange={(e) => setComfort({ ...comfort, minAttackSpeed: Number(e.target.value) })}
                  />
                </label>
              ) : (
                <label className="text-xs text-zinc-500">
                  Max fire rate bonus %
                  <input
                    type="number"
                    step={10}
                    className="field mt-1"
                    value={Math.round(comfort.maxFireRateBonus * 100)}
                    onChange={(e) => setComfort({ ...comfort, maxFireRateBonus: Number(e.target.value) / 100 })}
                  />
                </label>
              )}
              {isMelee && (
                <label className="text-xs text-zinc-500">
                  Range: max DPS cost %
                  <input
                    type="number"
                    step={1}
                    className="field mt-1"
                    value={Math.round(comfort.rangeTolerance * 100)}
                    onChange={(e) => setComfort({ ...comfort, rangeTolerance: Number(e.target.value) / 100 })}
                  />
                </label>
              )}
            </div>
          )}

          <Toggle label="Realistic (mod capacity and polarities)" checked={realistic} onChange={setRealistic} />
          {realistic && (
            <div className="space-y-2">
              <label className="text-xs text-zinc-500">
                Capacity (60 with reactor/catalyst; add your stance bonus for melee)
                <input type="number" className="field mt-1" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
              </label>
              <div className="grid grid-cols-3 gap-1">
                {polarities.map((p, i) => (
                  <select
                    key={i}
                    className="field py-1 text-xs"
                    value={p ?? ""}
                    onChange={(e) => {
                      const next = [...polarities];
                      next[i] = e.target.value || null;
                      setPolarities(next);
                    }}
                    aria-label={i === SLOT_COUNT ? "Exilus polarity" : `Slot ${i + 1} polarity`}
                  >
                    <option value="">{i === SLOT_COUNT ? "Exilus: none" : `Slot ${i + 1}: none`}</option>
                    {POLARITIES.map((pol) => (
                      <option key={pol} value={pol}>
                        {i === SLOT_COUNT ? "Exilus: " : `${i + 1}: `}
                        {pol}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
              <p className="text-[11px] text-zinc-500">Drain at max rank; matching polarity halves it, a different polarity adds 25%. A riven counts as 9.</p>
            </div>
          )}
        </div>
      </details>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
        {hasEvolutions && (
          <label className="flex items-center gap-1" title="The optimizer keeps the evolutions picked below; tiers set to none are still searched">
            <input type="checkbox" className="accent-indigo-600" checked={keepEvolutions} onChange={(e) => setKeepEvolutions(e.target.checked)} />
            Keep my evolutions
          </label>
        )}
        <label className="flex items-center gap-1" title="The optimizer keeps the arcane you picked (none picked = it chooses one)">
          <input type="checkbox" className="accent-indigo-600" checked={keepArcane} onChange={(e) => setKeepArcane(e.target.checked)} />
          Keep my arcane
        </label>
        {goals.length > 0 && <span title="Set in Optimizer options">{goals.length} stat goal{goals.length > 1 ? "s" : ""} on</span>}
      </div>
      {lockedNames.length > 0 ? (
        <p className="text-xs text-zinc-600 dark:text-zinc-300">
          <span className="font-medium text-amber-600 dark:text-amber-400">Locked:</span> {lockedNames.join(", ")}. The optimizer keeps these and builds the
          rest around them.{" "}
          <button type="button" className="text-indigo-600 hover:underline" onClick={() => setBuild({ ...build, locked: [] })}>
            Unlock all
          </button>
        </p>
      ) : (
        <p className="text-[11px] text-zinc-500">Lock a mod (the padlock on its card) and the optimizer builds the rest around it.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={!!busy}
          onClick={gradeRiven}
          className="rounded-md border border-fuchsia-500 px-3 py-1.5 text-sm text-fuchsia-700 hover:bg-fuchsia-50 disabled:opacity-60 dark:text-fuchsia-300 dark:hover:bg-fuchsia-950/40"
        >
          {busy === "grade" ? "Grading…" : "Grade my riven"}
        </button>
        <button
          disabled={!!busy || !build.riven.positives.length}
          onClick={() => {
            const mine = rivenModifiers(data!, build.riven, weapon.modPool);
            if (mine.length) apply("Best build for my riven", { fixedRiven: mine });
          }}
          title={build.riven.positives.length ? "Keeps your riven's rolls and finds the best mods, arcane and evolutions around it" : "Add your riven's stats in the riven editor first"}
          className="rounded-md border border-fuchsia-500 px-3 py-1.5 text-sm text-fuchsia-700 hover:bg-fuchsia-50 disabled:opacity-60 dark:text-fuchsia-300 dark:hover:bg-fuchsia-950/40"
        >
          {busy === "Best build for my riven" ? "Searching…" : "Best build for my riven"}
        </button>
        {grade && (
          <span className="text-sm">
            <span className="font-semibold">{pct(grade.ratio, 0)}</span> of a god roll{" "}
            <span className="text-xs text-zinc-500">
              ({fmt(grade.mine)} vs {fmt(grade.god)} with each riven's best build)
            </span>
          </span>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function GoalEditor({ weapon, goals, setGoals, mode }: { weapon: Weapon; goals: StatGoal[]; setGoals: (g: StatGoal[]) => void; mode: number | "auto" }) {
  const { data, engine, scenario } = useStore();
  const defs = goalDefs(!!weapon.melee);
  // The unmodded attack the goals start from (with the scenario's buffs).
  const base = useMemo(() => {
    const empty: EditorBuild = { weapon: weapon.id, slots: [], arcane: null, riven: emptyRiven(), evolutions: [] };
    const r = compute(engine!, engineBuild(data!, empty, scenario), scenario.target).ok;
    if (!r) return undefined;
    if (mode !== "auto") return r.modes.find((m) => m.modeIndex === mode);
    const main = weapon.modes.findIndex((m) => m.meleeRole !== "heavy");
    return r.modes.find((m) => m.modeIndex === Math.max(0, main)) ?? r.modes[0];
  }, [data, engine, scenario, weapon, mode]);
  const set = (i: number, g: Partial<StatGoal>) => setGoals(goals.map((x, j) => (j === i ? { ...x, ...g } : x)));
  const unused = defs.find((d) => !goals.some((g) => g.stat === d.stat));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="label mb-0">Stat goals</span>
        {unused && (
          <button
            type="button"
            className="ml-auto text-xs text-indigo-600 hover:underline"
            onClick={() => setGoals([...goals, { stat: unused.stat, value: unused.atMost ? -0.3 : 1, relative: true }])}
          >
            + Add goal
          </button>
        )}
      </div>
      {goals.length === 0 ? (
        <p className="text-[11px] text-zinc-500">
          A target for a stat (fire rate +200%, 15 shots/s, 50% status…). Builds that reach every goal rank above builds that don't; among those the
          objective above picks the best.
        </p>
      ) : (
        goals.map((g, i) => {
          const d = defs.find((x) => x.stat === g.stat) ?? defs[0];
          const pctUnit = g.relative || d.unit === "%";
          const shown = pctUnit ? +(g.value * 100).toFixed(2) : g.value;
          const from = base ? d.of(base) : undefined;
          const target = from == null ? undefined : g.relative ? from * (1 + g.value) : g.value;
          return (
            <div key={i} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  className="field w-auto flex-1 py-1 text-xs"
                  value={g.stat}
                  aria-label="Goal stat"
                  onChange={(e) => {
                    const nd = defs.find((x) => x.stat === e.target.value)!;
                    set(i, { stat: nd.stat, relative: true, value: nd.atMost ? -0.3 : 1 });
                  }}
                >
                  {defs
                    .filter((x) => x.stat === g.stat || !goals.some((o) => o.stat === x.stat))
                    .map((x) => (
                      <option key={x.stat} value={x.stat}>
                        {x.label}
                      </option>
                    ))}
                </select>
                <span className="text-xs text-zinc-500">{d.atMost ? "at most" : "at least"}</span>
                <input
                  type="number"
                  className="field w-20 py-1 text-xs"
                  aria-label="Goal value"
                  step={pctUnit ? 10 : d.unit === "/s" || d.unit === "×" ? 0.1 : 1}
                  value={shown}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    set(i, { value: pctUnit ? n / 100 : n });
                  }}
                />
                <select
                  className="field w-auto py-1 text-xs"
                  aria-label="Goal unit"
                  value={g.relative ? "rel" : "abs"}
                  onChange={(e) => {
                    const relative = e.target.value === "rel";
                    if (relative === g.relative) return;
                    // Same target in the other unit.
                    const value =
                      from && from > 0 && target != null ? (relative ? target / from - 1 : target) : relative ? (d.atMost ? -0.3 : 1) : (from ?? 1);
                    set(i, { relative, value: +value.toFixed(4) });
                  }}
                >
                  <option value="rel">{d.atMost ? "% change" : "% over base"}</option>
                  <option value="abs">{d.unit === "%" ? "% total" : d.unit || "total"}</option>
                </select>
                <button
                  type="button"
                  className="px-1 text-zinc-400 hover:text-red-600"
                  aria-label="Remove goal"
                  onClick={() => setGoals(goals.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
              {from != null && target != null && (
                <p className="mt-1 text-[11px] text-zinc-500">
                  {base?.mode}: unmodded {goalValue(d, from)} → goal {goalValue(d, target)}
                  {g.relative && mode === "auto" && weapon.modes.length > 1 ? " (other attacks: from their own unmodded value)" : ""}
                </p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
