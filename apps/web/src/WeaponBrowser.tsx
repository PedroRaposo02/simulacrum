import { Fragment, useEffect, useMemo, useState } from "react";
import { usePersistent } from "./persist";
import { weaponTypeLabel } from "./labels";
import BestBuildDisclaimer from "./Disclaimer";
import { Star, useFavorites } from "./favorites";

const PAGE_KEY = "simulacrum.pageSize";
const PAGE_SIZES = [25, 50, 100, 0] as const;
function savedPageSize(): number {
  try {
    const n = Number(localStorage.getItem(PAGE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : 25;
  } catch {
    return 25;
  }
}
import { fmt, rank, scenarioBuild, targetKey, useStore, type BrowserBuild } from "./store";
import { CoverageBadge, Segmented } from "./Common";
import type { BestEntry, BestPair, RankRow, Slot } from "./types";

type Fight = "single" | "group";
type Attack = "light" | "heavy";
/** The precomputed build for a riven choice, fight type and (melee) attack. */
function pick(p: BestPair | undefined, riven: boolean, fight: Fight, heavy: boolean): BestEntry | undefined {
  if (!p) return undefined;
  const key = `${heavy ? "heavy" : ""}${fight === "group" ? "Group" : ""}${riven ? "Riven" : "Plain"}`;
  const k = key.charAt(0).toLowerCase() + key.slice(1);
  return (p as Record<string, BestEntry | undefined>)[k];
}

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
  const [slot, setSlot] = usePersistent<Slot>("browser.slot", "primary");
  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = usePersistent("browser.favOnly", false);
  const favs = useFavorites();
  // Sustained by default: burst flatters weapons that must reload after every shot.
  const [sortKey, setSortKey] = usePersistent<SortKey>("browser.sort", "sustainedDps");
  const [fight, setFight] = usePersistent<Fight>("browser.fight", "single");
  const [attack, setAttack] = usePersistent<Attack>("browser.attack", "light");
  const heavy = slot === "melee" && attack === "heavy";
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pageSize, setPageSizeState] = useState<number>(savedPageSize);
  const [page, setPage] = useState(0);
  const setPageSize = (n: number) => {
    setPageSizeState(n);
    setPage(0);
    try {
      localStorage.setItem(PAGE_KEY, String(n));
    } catch {
      // not persisted
    }
  };
  const weaponById = useMemo(() => new Map(data!.weapons.map((w) => [w.id, w])), [data]);

  // Best builds were optimized per enemy preset; look up the one for the current enemy.
  const bestForTarget = best?.targets[targetKey(scenario.target)];
  // Group builds aren't computed against a lone boss: fall back to the single-target ones.
  const entryFor = (id: string): BestEntry | undefined => {
    if (browserBuild === "unmodded") return undefined;
    const p = bestForTarget?.[id];
    const riven = browserBuild === "bestRiven";
    return pick(p, riven, fight, heavy) ?? pick(p, riven, "single", heavy);
  };

  const rows = useMemo(() => {
    const perWeapon: Record<string, Partial<BestEntry>> = {};
    for (const w of data!.weapons) {
      const e = entryFor(w.id);
      if (e) perWeapon[w.id] = e;
      else if (heavy && w.slot === "melee") {
        // Unmodded heavy attack.
        const i = w.modes.findIndex((m) => m.meleeRole === "heavy");
        if (i >= 0) perWeapon[w.id] = { mods: [], arcane: null, modeIndex: i };
      }
    }
    return rank(engine!, scenario.target, scenarioBuild(data!, scenario), perWeapon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, data, scenario, browserBuild, bestForTarget, fight, heavy]);
  // Burst / sustained of the chosen fight type.
  const burstOf = (r: RankRow) => (fight === "group" ? r.groupDps : r.burstDps);
  const sustainedOf = (r: RankRow) => (fight === "group" ? r.groupSustainedDps : r.sustainedDps);
  const valueOf = (r: RankRow, k: SortKey) => (k === "burstDps" ? burstOf(r) : k === "sustainedDps" ? sustainedOf(r) : r.perShot);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const w of data!.weapons) c[w.slot] = (c[w.slot] ?? 0) + 1;
    return c;
  }, [data]);

  const shown = useMemo(() => {
    const q = query.toLowerCase();
    return rows
      .filter((r) => r.slot === slot && (!q || r.name.toLowerCase().includes(q)) && (!favOnly || favs.weapons.includes(r.weaponId)))
      .sort((a, b) => valueOf(b, sortKey) - valueOf(a, sortKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, slot, query, sortKey, favOnly, favs.weapons, fight]);
  useEffect(() => setPage(0), [slot, query, sortKey]);
  const pages = pageSize ? Math.max(1, Math.ceil(shown.length / pageSize)) : 1;
  const pageRows = pageSize ? shown.slice(page * pageSize, (page + 1) * pageSize) : shown;
  const firstRank = pageSize ? page * pageSize : 0;

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
        <label className="flex items-center gap-1 text-sm text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" className="accent-amber-400" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} />★ Favorites only
        </label>
        <Segmented<BrowserBuild>
          value={browserBuild}
          onChange={setBrowserBuild}
          options={[
            ["unmodded", "Unmodded"],
            ["best", "Most DPS Build"],
            ["bestRiven", "Most DPS + riven"],
          ]}
        />
        <Segmented<Fight>
          value={fight}
          onChange={setFight}
          options={[
            ["single", "Single target"],
            ["group", `Group (${scenario.conditions.groupSize ?? 5})`],
          ]}
        />
        {slot === "melee" && (
          <Segmented<Attack>
            value={attack}
            onChange={setAttack}
            options={[
              ["light", "Light / combos"],
              ["heavy", "Heavy attack"],
            ]}
          />
        )}
      </div>

      {usingBest && !best && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {import.meta.env.DEV ? (
            <>
              No precomputed Most DPS builds found. Run <code>pnpm optimize</code> to generate them; showing unmodded numbers.
            </>
          ) : (
            <>
              The best builds for this version are still being calculated and appear here shortly (reload the page later); unmodded
              numbers are shown meanwhile. The optimizer in the build editor works for any weapon right now.
            </>
          )}
        </p>
      )}
      {usingBest && best && (
        <p className="text-xs text-zinc-500">
          Most DPS builds (any polarity, no capacity limit{browserBuild === "bestRiven" ? ", max-roll riven" : ""}), optimized for this enemy with
          full conditional uptime, then re-evaluated with your scenario. Buffs and outsourced status weren't part of the search.
          {bestStale && " These were computed for an earlier game data version; updated builds are being generated and replace them shortly."}
        </p>
      )}
      {usingBest && best && <BestBuildDisclaimer compact />}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-2 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">Weapon</th>
              <th className="px-2 py-2 text-left font-medium">Mode</th>
              {th("perShot", "Per shot")}
              {th("burstDps", fight === "group" ? "Group burst" : "Burst DPS")}
              {th("sustainedDps", fight === "group" ? "Group sustained" : "Sustained")}
              <th className="px-2 py-2 text-left font-medium">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, idx) => {
              const i = firstRank + idx;
              const e = entryFor(r.weaponId);
              const isOpen = expanded === r.weaponId;
              return (
                <Fragment key={r.weaponId}>
                  <tr
                    onClick={() => (usingBest && e ? setExpanded(isOpen ? null : r.weaponId) : openWeapon(r.weaponId))}
                    className="cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-indigo-50 dark:border-zinc-800/60 dark:hover:bg-indigo-950/40"
                  >
                    <td className="num px-2 py-1.5 text-zinc-400">
                      <span className="mr-1.5">
                        <Star on={favs.weapons.includes(r.weaponId)} onClick={() => favs.toggleWeapon(r.weaponId)} label={r.name} />
                      </span>
                      {i + 1}
                    </td>
                    <td className="px-2 py-1.5 font-medium">
                      {usingBest && e && <span className="mr-1 text-zinc-400">{isOpen ? "▾" : "▸"}</span>}
                      {r.name}{" "}
                      <span className="text-xs font-normal text-zinc-500">{weaponById.get(r.weaponId) ? weaponTypeLabel(weaponById.get(r.weaponId)!) : r.class}</span>
                    </td>
                    <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">{r.failed ?? r.mode}</td>
                    <td className="num px-2 py-1.5 text-right">{fmt(r.perShot)}</td>
                    <td className="num px-2 py-1.5 text-right font-medium">{fmt(burstOf(r))}</td>
                    <td className="num px-2 py-1.5 text-right">{fmt(sustainedOf(r))}</td>
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
                              {e.rivenNegative && (
                                <div className="text-red-600 dark:text-red-400">
                                  {(e.rivenNegative.value * 100).toFixed(1)}% {e.rivenNegative.label}
                                </div>
                              )}
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
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-zinc-500">
          Per page
          <select className="field w-auto py-1" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n || "All"}
              </option>
            ))}
          </select>
        </label>
        {pageSize > 0 && pages > 1 && (
          <div className="ml-auto flex items-center gap-1">
            <button className="rounded px-2 py-1 hover:bg-zinc-200 disabled:opacity-40 dark:hover:bg-zinc-800" disabled={page === 0} onClick={() => setPage(0)} aria-label="First page">
              «
            </button>
            <button className="rounded px-2 py-1 hover:bg-zinc-200 disabled:opacity-40 dark:hover:bg-zinc-800" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
              ‹
            </button>
            <span className="px-2 tabular-nums text-zinc-500">
              {page + 1} / {pages}
            </span>
            <button className="rounded px-2 py-1 hover:bg-zinc-200 disabled:opacity-40 dark:hover:bg-zinc-800" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page">
              ›
            </button>
            <button className="rounded px-2 py-1 hover:bg-zinc-200 disabled:opacity-40 dark:hover:bg-zinc-800" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)} aria-label="Last page">
              »
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
