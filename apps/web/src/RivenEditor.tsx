import { formatRivenValue, layoutOf, rivenType, rowValue, statRange } from "./riven";
import { useState } from "react";
import { fmt, pct, placeRiven, rankRivensInWorker, scenarioBuild, useStore } from "./store";
import type { RivenRanking, RivenRow, RivenState, Weapon } from "./types";

const SHOWN = 30;

// Community riven grading: deviation of a roll from the centre of its range (-10%..+10%).
// S: a perfect roll (within 0.1% of the maximum).
const GRADES: [number, string][] = [
  [9.9, "S"], [9.5, "A+"], [7.5, "A"], [5.5, "A-"], [3.5, "B+"], [1.5, "B"], [-1.5, "C"],
  [-3.5, "C-"], [-5.5, "D+"], [-7.5, "D"], [-9.5, "D-"],
];
/** Roll 0..1 across rollMin..rollMax -> % deviation from the centre value. */
function deviation(roll: number, min: number, max: number): number {
  const centre = (min + max) / 2;
  return ((min + roll * (max - min)) / centre - 1) * 100;
}
function grade(dev: number): string {
  return GRADES.find(([t]) => dev >= t - 1e-9)?.[1] ?? "F";
}
function gradeClass(g: string): string {
  if (g === "S") return "bg-fuchsia-600 text-white";
  if (g.startsWith("A")) return "bg-emerald-600 text-white";
  if (g.startsWith("B")) return "bg-sky-600 text-white";
  if (g.startsWith("C")) return "bg-zinc-500 text-white";
  if (g.startsWith("D")) return "bg-amber-600 text-white";
  return "bg-red-700 text-white";
}
function GradeBadge({ dev }: { dev: number }) {
  const g = grade(dev);
  return (
    <span
      className={`inline-block w-7 rounded text-center text-[10px] font-bold ${gradeClass(g)}`}
      title={`${dev >= 0 ? "+" : ""}${dev.toFixed(1)}% from the centre of the roll range (S = perfect roll, A+ ≥ 9.5%, C ≈ centre, F ≤ -9.5%)`}
    >
      {g}
    </span>
  );
}

/** Every 2-3 positive roll for this weapon, best to worst, scored with its best riven build. */
function RollRanking({ weapon, onUse }: { weapon: Weapon; onUse: (keys: string[]) => void }) {
  const { data, scenario } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ranking, setRanking] = useState<RivenRanking | null>(null);
  const [spliced, setSpliced] = useState(true);
  const [all, setAll] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    const r = await rankRivensInWorker(weapon.id, scenarioBuild(data!, scenario), scenario.target, { splicedRiven: spliced });
    setBusy(false);
    if (r.ok) setRanking(r.ok);
    else setError(r.error?.message ?? "ranking failed");
  };
  const rolls = ranking ? (all ? ranking.rolls : ranking.rolls.slice(0, SHOWN)) : [];
  return (
    <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <label className="label mb-0">Roll ranking</label>
        <label className="flex items-center gap-1 text-xs text-zinc-500">
          <input type="checkbox" className="accent-indigo-600" checked={spliced} onChange={(e) => setSpliced(e.target.checked)} />
          include spliced stats
        </label>
        <button
          disabled={busy}
          onClick={run}
          className="ml-auto rounded-md border border-fuchsia-500 px-2 py-1 text-xs text-fuchsia-700 hover:bg-fuchsia-50 disabled:opacity-60 dark:text-fuchsia-300 dark:hover:bg-fuchsia-950/40"
        >
          {busy ? "Ranking…" : ranking ? "Re-rank" : "Rank all rolls"}
        </button>
      </div>
      <p className="text-[11px] text-zinc-500">
        Every combination of 2–3 positive stats (max rolls, harmless negative), scored with this weapon&apos;s best riven build for the current scenario.
        Rolls near 100% are worth keeping; anything far below is a reroll.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {ranking && (
        <>
          <ol className="max-h-80 space-y-0.5 overflow-y-auto text-xs">
            {rolls.map((r, i) => (
              <li key={r.stats.map((s) => s.key).join("+")} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-right tabular-nums text-zinc-400">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate" title={r.stats.map((s) => s.label).join(" + ")}>
                  {r.stats.map((s) => s.label).join(" + ")}
                  {r.spliced ? <span className="ml-1 text-fuchsia-600 dark:text-fuchsia-400">spliced</span> : null}
                </span>
                <span className="h-1.5 w-16 shrink-0 rounded bg-zinc-100 dark:bg-zinc-800">
                  <span className="block h-1.5 rounded bg-fuchsia-500" style={{ width: `${Math.max(2, r.ratio * 100)}%` }} />
                </span>
                <span className="w-12 shrink-0 text-right tabular-nums">{pct(r.ratio, 0)}</span>
                <button className="shrink-0 text-indigo-600 hover:underline" onClick={() => onUse(r.stats.map((s) => s.key))}>
                  Use
                </button>
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span>
              {ranking.rolls.length} rolls · best {fmt(ranking.rolls[0]?.score ?? 0)} on {ranking.mode}
            </span>
            {ranking.rolls.length > SHOWN && (
              <button className="ml-auto text-indigo-600 hover:underline" onClick={() => setAll(!all)}>
                {all ? `Show top ${SHOWN}` : `Show all ${ranking.rolls.length}`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Riven with up to 3 positives and 1 negative; each stat has a slider across its real roll range. */
export default function RivenEditor({ weapon }: { weapon: Weapon }) {
  const { data, build, setBuild } = useStore();
  const table = data!.riven;
  if (!table) return null;
  const ty = rivenType(weapon.modPool);
  const riven = build.riven;
  const layout = layoutOf(table, riven);
  const [notice, setNotice] = useState<string | null>(null);
  // The riven takes the last normal slot; a mod sitting there moves to a free slot (or is removed).
  const setRiven = (r: RivenState) => {
    const { build: next, displaced } = placeRiven({ ...build, riven: r });
    setBuild(next);
    const name = displaced && data!.mods.find((m) => m.id === displaced)?.name;
    setNotice(name ? `${name} was removed: the riven needs a slot and every other slot is full.` : null);
  };

  const available = table.stats.filter((s) => s.base[ty] != null);
  const used = new Set([...riven.positives.map((p) => p.key), riven.negative?.key].filter(Boolean));

  const row = (r: RivenRow | null, i: number, negative: boolean) => {
    const range = r && layout ? statRange(table, r.key, ty, layout, negative) : null;
    const value = r && layout ? rowValue(table, r, ty, layout, negative) : null;
    const options = available.filter((s) => (negative || s.stat) && (s.key === r?.key || !used.has(s.key)));
    const setRow = (next: RivenRow | null) => {
      if (negative) return setRiven({ ...riven, negative: next });
      const positives = [...riven.positives];
      if (next) positives[i] = next;
      else positives.splice(i, 1);
      setRiven({ ...riven, positives });
    };
    return (
      <div key={`${negative}-${i}`} className="space-y-1">
        <div className="flex gap-2">
          <select
            className="field"
            value={r?.key ?? ""}
            onChange={(e) => setRow(e.target.value ? { key: e.target.value, roll: r?.roll ?? 1 } : null)}
          >
            <option value="">{negative ? "— negative (optional) —" : `— positive ${i + 1} —`}</option>
            <optgroup label="Stats">
              {options
                .filter((s) => !s.spliced)
                .map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                    {negative && !s.stat ? " (harmless)" : !s.stat ? " (no modelled effect)" : ""}
                  </option>
                ))}
            </optgroup>
            {options.some((s) => s.spliced) && (
              <optgroup label="Spliced only">
                {options
                  .filter((s) => s.spliced)
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
          <span className={`num w-20 shrink-0 self-center text-right text-sm font-medium ${negative ? "text-red-600 dark:text-red-400" : ""}`}>
            {value == null || !r ? "" : formatRivenValue(table, r.key, value)}
          </span>
          {r && range ? (
            <span className="self-center">
              <GradeBadge dev={deviation(r.roll, table.rollMin, table.rollMax)} />
            </span>
          ) : null}
        </div>
        {r && range && (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={r.roll}
              onChange={(e) => setRow({ ...r, roll: Number(e.target.value) })}
              className="w-full accent-indigo-600"
              aria-label={`${r.key} roll`}
            />
            <span className="num w-28 shrink-0 text-right text-[11px] text-zinc-500">
              {formatRivenValue(table, r.key, range[0])} … {formatRivenValue(table, r.key, range[1])}
            </span>
          </div>
        )}
      </div>
    );
  };

  const slots = [...riven.positives];
  const showEmpty = slots.length < 3;
  const graded = [...riven.positives, ...(riven.negative ? [riven.negative] : [])];
  const avgRoll = graded.length > 0 ? graded.reduce((a, p) => a + p.roll, 0) / graded.length : null;

  return (
    <div id="riven-editor" className="card space-y-3">
      <div className="flex items-center justify-between">
        <label className="label mb-0">Riven</label>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          {layout ? `${layout.positives}+${layout.negative ? 1 : 0} layout` : "pick 2–3 positives"}
          {avgRoll != null && layout && (
            <>
              <span>· roll grade</span>
              <GradeBadge dev={deviation(avgRoll, table.rollMin, table.rollMax)} />
            </>
          )}
        </span>
      </div>
      {slots.map((r, i) => row(r, i, false))}
      {showEmpty && row(null, slots.length, false)}
      {row(riven.negative, 0, true)}
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          onClick={() => setRiven({ positives: riven.positives.map((p) => ({ ...p, roll: 1 })), negative: riven.negative && { ...riven.negative, roll: 1 } })}
        >
          Max rolls
        </button>
        <button
          className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          onClick={() => setRiven({ positives: [], negative: null })}
        >
          Clear
        </button>
      </div>
      {notice && <p className="text-xs text-amber-700 dark:text-amber-400">{notice}</p>}
      <RollRanking
        weapon={weapon}
        onUse={(keys) => {
          const harmless = table.stats.find((s) => !s.stat && s.base[ty] != null);
          setRiven({ positives: keys.map((key) => ({ key, roll: 1 })), negative: harmless ? { key: harmless.key, roll: 1 } : null });
        }}
      />
      <p className="text-[11px] text-zinc-500">
        Range = base × {table.disposition} disposition × layout × {table.rollMin}–{table.rollMax}. For negatives, the right end is the smallest penalty.
      </p>
    </div>
  );
}
