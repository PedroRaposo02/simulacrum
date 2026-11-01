import { useMemo, useState } from "react";
import { fmt, rank, useStore } from "./store";
import { CoverageBadge, EnemyPicker } from "./Common";
import type { Slot } from "./types";

const SLOTS: [Slot | "", string][] = [
  ["", "All slots"],
  ["primary", "Primary"],
  ["secondary", "Secondary"],
  ["archGun", "Arch-gun"],
  ["companion", "Companion"],
];

export default function WeaponBrowser() {
  const { engine, target, openWeapon } = useStore();
  const [slot, setSlot] = useState<Slot | "">("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"burstDps" | "sustainedDps" | "perShot">("burstDps");

  const rows = useMemo(() => rank(engine!, target), [engine, target]);
  const shown = useMemo(() => {
    const q = query.toLowerCase();
    return rows
      .filter((r) => (!slot || r.slot === slot) && (!q || r.name.toLowerCase().includes(q)))
      .sort((a, b) => b[sortKey] - a[sortKey]);
  }, [rows, slot, query, sortKey]);

  const th = (key: typeof sortKey, label: string) => (
    <th className="cursor-pointer px-2 py-2 text-right font-medium hover:text-indigo-600" onClick={() => setSortKey(key)}>
      {label}
      {sortKey === key ? " ▾" : ""}
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="card grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Search</label>
          <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Weapon name" />
        </div>
        <div>
          <label className="label">Slot</label>
          <select className="field" value={slot} onChange={(e) => setSlot(e.target.value as Slot | "")}>
            {SLOTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Enemy</label>
          <EnemyPicker />
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        Unmodded, best attack mode per weapon. Click a weapon to build it. {shown.length} shown.
      </p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-2 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">Weapon</th>
              <th className="px-2 py-2 text-left font-medium">Best mode</th>
              {th("perShot", "Per shot")}
              {th("burstDps", "Burst DPS")}
              {th("sustainedDps", "Sustained")}
              <th className="px-2 py-2 text-left font-medium">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr
                key={r.weaponId}
                onClick={() => openWeapon(r.weaponId)}
                className="cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-indigo-50 dark:border-zinc-800/60 dark:hover:bg-indigo-950/40"
              >
                <td className="num px-2 py-1.5 text-zinc-400">{i + 1}</td>
                <td className="px-2 py-1.5 font-medium">
                  {r.name} <span className="text-xs font-normal capitalize text-zinc-500">{r.class}</span>
                </td>
                <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">{r.failed ?? r.mode}</td>
                <td className="num px-2 py-1.5 text-right">{fmt(r.perShot)}</td>
                <td className="num px-2 py-1.5 text-right font-medium">{fmt(r.burstDps)}</td>
                <td className="num px-2 py-1.5 text-right">{fmt(r.sustainedDps)}</td>
                <td className="px-2 py-1.5">
                  <CoverageBadge c={r.coverage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
