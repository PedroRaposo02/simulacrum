import { Fragment, useMemo, useState } from "react";
import { fmt, rank, scenarioBuild, targetKey, useStore, type BrowserBuild } from "./store";
import { CoverageBadge, Segmented } from "./Common";
import type { BestEntry, Slot } from "./types";

const CATEGORIES: [Slot, string][] = [
  ["primary", "Primary"],
  ["secondary", "Secondary"],
  ["melee", "Melee"],
  ["archGun", "Arch-gun"],
  ["companion", "Companion"],
];

type SortKey = "burstDps" | "sustainedDps" | "perShot";

export default function WeaponBrowser() {
  const { data, engine, best, bestStale, scenario, browserBuild, setBrowserBuild, openWeapon } = useStore();
  const [slot, setSlot] = useState<Slot>("primary");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("burstDps");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Best builds were optimized per enemy preset; look up the one for the current enemy.
  const bestForTarget = best?.targets[targetKey(scenario.target)];
  const entryFor = (id: string): BestEntry | undefined => {
    const p = bestForTarget?.[id];
    return browserBuild === "best" ? p?.plain : browserBuild === "bestRiven" ? p?.riven : undefined;
  };

  const rows = useMemo(() => {
    const perWeapon: Record<string, BestEntry> = {};
    if (browserBuild !== "unmodded" && bestForTarget) {
      for (const [id, p] of Object.entries(bestForTarget)) {
        const e = browserBuild === "best" ? p.plain : p.riven;
        if (e) perWeapon[id] = e;
      }
    }
    return rank(engine!, scenario.target, scenarioBuild(data!, scenario), perWeapon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, data, scenario, browserBuild, bestForTarget]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const w of data!.weapons) c[w.slot] = (c[w.slot] ?? 0) + 1;
    return c;
  }, [data]);

  const shown = useMemo(() => {
    const q = query.toLowerCase();
    return rows.filter((r) => r.slot === slot && (!q || r.name.toLowerCase().includes(q))).sort((a, b) => b[sortKey] - a[sortKey]);
  }, [rows, slot, query, sortKey]);

  const th = (key: SortKey, label: string) => (
    <th className="cursor-pointer whitespace-nowrap px-2 py-2 text-right font-medium hover:text-indigo-600" onClick={() => setSortKey(key)}>
      {label}
      {sortKey === key ? " ▾" : ""}
    </th>
  );

  const usingBest = browserBuild !== "unmodded";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {CATEGORIES.map(([s, label]) => (
          <button
            key={s}
            onClick={() => setSlot(s)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              slot === s ? "border-indigo-600 text-indigo-600" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {label} <span className="text-xs text-zinc-400">{counts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input className="field max-w-xs" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search weapons" />
        <Segmented<BrowserBuild>
          value={browserBuild}
          onChange={setBrowserBuild}
          options={[
            ["unmodded", "Unmodded"],
            ["best", "Best build"],
            ["bestRiven", "Best + riven"],
          ]}
        />
      </div>

      {usingBest && !best && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          No precomputed best builds found. Run <code>pnpm optimize</code> to generate them; showing unmodded numbers.
        </p>
      )}
      {usingBest && best && (
        <p className="text-xs text-zinc-500">
          Theoretical best builds (any polarity, no capacity limit{browserBuild === "bestRiven" ? ", max-roll riven" : ""}), optimized for this enemy with
          full conditional uptime, then re-evaluated with your scenario. Buffs and outsourced status weren't part of the search.
          {bestStale && " Game data changed since these were generated; rerun pnpm optimize."}
        </p>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-2 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">Weapon</th>
              <th className="px-2 py-2 text-left font-medium">Mode</th>
              {th("perShot", "Per shot")}
              {th("burstDps", "Burst DPS")}
              {th("sustainedDps", "Sustained")}
              <th className="px-2 py-2 text-left font-medium">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const e = entryFor(r.weaponId);
              const isOpen = expanded === r.weaponId;
              return (
                <Fragment key={r.weaponId}>
                  <tr
                    onClick={() => (usingBest && e ? setExpanded(isOpen ? null : r.weaponId) : openWeapon(r.weaponId))}
                    className="cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-indigo-50 dark:border-zinc-800/60 dark:hover:bg-indigo-950/40"
                  >
                    <td className="num px-2 py-1.5 text-zinc-400">{i + 1}</td>
                    <td className="px-2 py-1.5 font-medium">
                      {usingBest && e && <span className="mr-1 text-zinc-400">{isOpen ? "▾" : "▸"}</span>}
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
                  {isOpen && e && (
                    <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800/60 dark:bg-zinc-900/60">
                      <td />
                      <td colSpan={6} className="px-2 py-2">
                        <div className="flex flex-wrap items-start gap-4 text-xs">
                          <div>
                            <div className="label">Mods</div>
                            <ol className="list-inside list-decimal">
                              {e.mods.map((m) => (
                                <li key={m}>{m}</li>
                              ))}
                            </ol>
                          </div>
                          <div>
                            <div className="label">Arcane</div>
                            {e.arcane ?? "—"}
                          </div>
                          {e.riven && e.riven.length > 0 && (
                            <div>
                              <div className="label">Riven (max roll)</div>
                              {e.riven.map((p) => (
                                <div key={p.key}>
                                  +{(p.value * 100).toFixed(1)}% {p.label}
                                </div>
                              ))}
                              {e.rivenNegative && <div className="text-zinc-500">{e.rivenNegative.label} (harmless −)</div>}
                            </div>
                          )}
                          <button
                            className="ml-auto rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500"
                            onClick={() => openWeapon(r.weaponId, e)}
                          >
                            Open in build editor
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
