import { formatRivenValue, layoutOf, rivenType, rowValue, statRange } from "./riven";
import { useState } from "react";
import { pct, placeRiven, useStore } from "./store";
import type { RivenRow, RivenState, Weapon } from "./types";

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
  const avgRoll =
    riven.positives.length > 0 ? riven.positives.reduce((a, p) => a + p.roll, 0) / riven.positives.length : null;

  return (
    <div id="riven-editor" className="card space-y-3">
      <div className="flex items-center justify-between">
        <label className="label mb-0">Riven</label>
        <span className="text-xs text-zinc-500">
          {layout ? `${layout.positives}+${layout.negative ? 1 : 0} layout` : "pick 2–3 positives"}
          {avgRoll != null && ` · ${pct(avgRoll, 0)} of max roll`}
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
      <p className="text-[11px] text-zinc-500">
        Range = base × {table.disposition} disposition × layout × {table.rollMin}–{table.rollMax}. For negatives, the right end is the smallest penalty.
      </p>
    </div>
  );
}
