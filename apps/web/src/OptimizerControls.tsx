import { useState } from "react";
import { rivenModifiers } from "./riven";
import { buildFromBest, fmt, optimizeInWorker, pct, scenarioBuild, SLOT_COUNT, useStore } from "./store";
import { Toggle } from "./Common";
import type { EditorBuild, Objective, OptimizeOptions, OptimizeResult, Weapon } from "./types";

const OBJECTIVES: [Objective, string, string][] = [
  ["burst", "Burst DPS", "Damage per second while firing"],
  ["sustained", "Sustained DPS", "Includes reloads"],
  ["perShot", "Damage per shot / combo", "Ignores fire rate entirely"],
  ["perCharge", "Damage per magazine / Incarnon charge", "Fire rate adds nothing: favours damage stats"],
];

const POLARITIES = ["madurai", "vazarin", "naramon", "zenurik", "unairu", "penjaga", "umbra"];

export interface ComfortSettings {
  on: boolean;
  /** Melee: attack speed floor. */
  minAttackSpeed: number;
  /** Melee: accept a range mod up to this DPS cost. */
  rangeTolerance: number;
  /** Guns: fire rate cap, so the magazine doesn't empty instantly. */
  maxFireRate: number;
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
  const { data, build, setBuild, scenario } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<number | "auto">("auto");
  const [realistic, setRealistic] = useState(false);
  const [capacity, setCapacity] = useState(60);
  const [polarities, setPolarities] = useState<(string | null)[]>(Array(SLOT_COUNT + 1).fill(null));
  const [grade, setGrade] = useState<{ ratio: number; god: number; mine: number } | null>(null);
  const [allowFaction, setAllowFaction] = useState(false);
  const [objective, setObjective] = useState<Objective>("burst");
  const [spliced, setSpliced] = useState(true);

  const isMelee = !!weapon.melee;
  const heavyIndex = weapon.modes.findIndex((m) => m.meleeRole === "heavy");

  const options = (extra: OptimizeOptions): OptimizeOptions => ({
    objective,
    splicedRiven: spliced,
    mode: mode === "auto" ? null : mode,
    minAttackSpeed: comfort.on && isMelee ? comfort.minAttackSpeed : null,
    maxFireRate: comfort.on && !isMelee ? comfort.maxFireRate : null,
    rangeTolerance: comfort.on && isMelee ? comfort.rangeTolerance : null,
    capacity: realistic ? { capacity, polarities, rivenDrain: 9 } : null,
    allowFaction,
    ...extra,
  });

  const run = async (label: string, extra: OptimizeOptions) => {
    setBusy(label);
    setError(null);
    const r = await optimizeInWorker(weapon.id, scenarioBuild(data!, scenario), scenario.target, options(extra));
    setBusy(null);
    if (!r.ok) {
      setError(r.error?.message ?? "optimizer failed");
      return null;
    }
    return r.ok;
  };

  const apply = async (label: string, extra: OptimizeOptions) => {
    const r = await run(label, extra);
    if (!r) return;
    const previous = build;
    const next = buildFromBest(data!, weapon, r);
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
    const god = await run("grade", { riven: true });
    const own = await run("grade", { fixedRiven: mine });
    if (god && own) setGrade({ ratio: own.score / god.score, god: god.score, mine: own.score });
  };

  const btn = "rounded-md px-3 py-1.5 text-sm text-white disabled:opacity-60";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button disabled={!!busy} onClick={() => apply("Best build", {})} className={`${btn} bg-indigo-600 hover:bg-indigo-500`}>
          {busy === "Best build" ? "Searching…" : "Best build"}
        </button>
        <button disabled={!!busy} onClick={() => apply("Best build + riven", { riven: true })} className={`${btn} bg-fuchsia-600 hover:bg-fuchsia-500`}>
          {busy === "Best build + riven" ? "Searching…" : "Best + riven"}
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

          <Toggle
            label="Allow faction mods (Bane, Expel, Smite…) and riven faction stats"
            checked={allowFaction}
            onChange={setAllowFaction}
          />

          <Toggle label="Allow spliced riven stats (Viral, Corrosive…; one per riven)" checked={spliced} onChange={setSpliced} />

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
                  Max shots/s
                  <input
                    type="number"
                    step={0.5}
                    className="field mt-1"
                    value={comfort.maxFireRate}
                    onChange={(e) => setComfort({ ...comfort, maxFireRate: Number(e.target.value) })}
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

      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={!!busy}
          onClick={gradeRiven}
          className="rounded-md border border-fuchsia-500 px-3 py-1.5 text-sm text-fuchsia-700 hover:bg-fuchsia-50 disabled:opacity-60 dark:text-fuchsia-300 dark:hover:bg-fuchsia-950/40"
        >
          {busy === "grade" ? "Grading…" : "Grade my riven"}
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
