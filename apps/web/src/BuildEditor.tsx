import { Fragment, useMemo, useState } from "react";
import { compute, engineBuild, fmt, pct, RIVEN_SLOT, shareLink, SLOT_COUNT, useStore } from "./store";
import { formatRivenValue, layoutOf, rivenType, rowValue } from "./riven";
import { CoverageBadge, ExplainTree } from "./Common";
import RivenEditor from "./RivenEditor";
import MeleeSummary from "./MeleeSummary";
import OptimizerControls, { type ComfortSettings, type OptimizerState } from "./OptimizerControls";
import SavedBuilds from "./SavedBuilds";
import ModGrid, { modSummary as cardSummary } from "./ModGrid";

type ModView = "cards" | "list";
const VIEW_KEY = "simulacrum.modView";
function savedView(): ModView {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}
import type { EditorBuild, Mod, ModeResult, OptimizeResult, Weapon } from "./types";

/** The riven drawn in its mod slot, with its rolled stats. */
function RivenSlot({ weapon, build }: { weapon: Weapon; build: EditorBuild }) {
  const { data } = useStore();
  const table = data!.riven!;
  const layout = layoutOf(table, build.riven);
  const ty = rivenType(weapon.modPool);
  const rows = [...build.riven.positives.map((r) => ({ r, neg: false })), ...(build.riven.negative ? [{ r: build.riven.negative, neg: true }] : [])];
  return (
    <button
      type="button"
      onClick={() => document.getElementById("riven-editor")?.scrollIntoView({ behavior: "smooth", block: "center" })}
      className="w-full rounded-md border border-fuchsia-400 bg-fuchsia-50 px-2 py-1.5 text-left text-sm dark:border-fuchsia-700 dark:bg-fuchsia-950/30"
      title="Edit the riven below"
    >
      <span className="font-medium text-fuchsia-700 dark:text-fuchsia-300">Riven</span>
      <span className="text-zinc-600 dark:text-zinc-300">
        {" · "}
        {rows
          .map(({ r, neg }) => {
            const def = table.stats.find((s) => s.key === r.key);
            const v = layout ? rowValue(table, r, ty, layout, neg) : null;
            return `${v == null ? "" : formatRivenValue(table, r.key, v) + " "}${def?.label ?? r.key}`;
          })
          .join(", ")}
      </span>
    </button>
  );
}

/** One select per Incarnon evolution tier. */
function EvolutionPicker({ weapon, build, setBuild }: { weapon: Weapon; build: EditorBuild; setBuild: (b: EditorBuild) => void }) {
  const tiers = weapon.evolutions ?? [];
  if (!tiers.length) return null;
  const chosen = (tier: number) => tiers[tier].options.find((o) => (build.evolutions ?? []).includes(o.name))?.name ?? "";
  const set = (tier: number, name: string) => {
    const others = (build.evolutions ?? []).filter((n) => !tiers[tier].options.some((o) => o.name === n));
    setBuild({ ...build, evolutions: name ? [...others, name] : others });
  };
  const ROMAN = ["", "I", "II", "III", "IV", "V"];
  return (
    <div>
      <label className="label">Incarnon evolutions</label>
      <div className="space-y-1.5">
        {tiers.map((t, i) => {
          const sel = t.options.find((o) => o.name === chosen(i));
          const effect = !sel ? "" : sel.modifiers?.length || sel.behaviour || sel.unparsed?.length ? "" : " (no damage effect)";
          return (
            <div key={t.tier}>
              <select className="field" value={chosen(i)} onChange={(e) => set(i, e.target.value)} aria-label={`Evolution ${ROMAN[t.tier]}`}>
                <option value="">Evolution {ROMAN[t.tier] ?? t.tier}: none</option>
                {t.options.map((o) => (
                  <option key={o.name} value={o.name} title={o.text}>
                    {ROMAN[t.tier] ?? t.tier}: {o.name}
                    {o.unparsed?.length ? " (partly modelled)" : ""}
                  </option>
                ))}
              </select>
              {sel && (
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {sel.text}
                  {sel.forms && sel.forms !== "both" ? ` · ${sel.forms === "incarnon" ? "Incarnon form only" : "normal form only"}` : ""}
                  {effect}
                  {sel.unparsed?.length ? (
                    <span className="block text-amber-700 dark:text-amber-400">Not modelled: {sel.unparsed.join("; ")}</span>
                  ) : null}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function modSummary(m: Mod) {
  const parts = m.modifiers.map((x) => {
    const val = `${x.value > 0 ? "+" : ""}${Math.round(x.value * 1000) / 10}%`;
    const what = x.stat.of ?? x.stat.kind;
    const per = x.per === "statusType" ? " per status" : x.per === "comboMultiplier" ? " per combo" : "";
    const cond = x.condition && x.condition !== "always" ? ` (${x.condition}${x.maxStacks && x.maxStacks > 1 ? ` ×${x.maxStacks}` : ""})` : "";
    return `${val} ${what}${per}${cond}`;
  });
  if (m.locksFireRate) parts.push("locks fire rate");
  if (m.enablesTennokai) parts.push("enables Tennokai");
  return parts.join(", ") || "no modelled effect";
}

function ModSlot({ value, options, used, onChange, label }: {
  value: string; options: Mod[]; used: Set<string>; onChange: (id: string) => void; label: string;
}) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">— {label} —</option>
      {options
        .filter((m) => m.id === value || !used.has(m.id))
        .map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} · {cardSummary(m)}
          </option>
        ))}
    </select>
  );
}

function ModeCard({ m }: { m: ModeResult }) {
  const stats: [string, number | null][] = [
    ["Per shot", m.perShot],
    ["Burst DPS", m.burstDps],
    ["Sustained DPS", m.sustainedDps],
    ["Per Incarnon charge", m.perCharge],
    ["Status DPS (approx.)", m.statusDps],
  ];
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{m.mode}</h3>
        <CoverageBadge c={m.coverage} />
        <span className="num ml-auto text-xs text-zinc-500">
          {fmt(m.fireRate)} shots/s · mag {m.magazine ?? "—"} · reload {fmt(m.reloadS)}s · viral {fmt(m.viralStacks)} · corrosive{" "}
          {fmt(m.corrosiveStacks)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stats.map(([l, v]) => (
          <div key={l} className="rounded-md bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">
            <div className="text-[11px] uppercase text-zinc-500">{l}</div>
            <div className="num text-lg font-semibold">{v == null ? "—" : fmt(v)}</div>
          </div>
        ))}
      </div>
      {m.approximations.length > 0 && (
        <ul className="list-inside list-disc text-xs text-amber-700 dark:text-amber-400">
          {m.approximations.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-indigo-600">How this number is computed</summary>
        <div className="mt-2 border-l border-zinc-200 pl-2 dark:border-zinc-700">
          <ExplainTree node={m.explain} />
        </div>
      </details>
    </div>
  );
}

/** Melee weapons have a dozen combos: show them as a table, expandable per row. */
function MeleeModeTable({ modes, weapon }: { modes: ModeResult[]; weapon: Weapon }) {
  const [open, setOpen] = useState<number | null>(null);
  const roleLabel: Record<string, string> = { light: "Light", heavy: "Heavy", tennokai: "Tennokai", other: "Other" };
  const sorted = [...modes].sort((a, b) => {
    const ra = weapon.modes[a.modeIndex]?.meleeRole === "light" ? 0 : 1;
    const rb = weapon.modes[b.modeIndex]?.meleeRole === "light" ? 0 : 1;
    return ra - rb || b.burstDps - a.burstDps;
  });
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
          <tr>
            <th className="px-2 py-2 text-left font-medium">Attack</th>
            <th className="px-2 py-2 text-left font-medium">Type</th>
            <th className="px-2 py-2 text-right font-medium">Per combo / hit</th>
            <th className="px-2 py-2 text-right font-medium">DPS</th>
            <th className="px-2 py-2 text-right font-medium">Combo</th>
            <th className="px-2 py-2 text-left font-medium">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => {
            const def = weapon.modes[m.modeIndex];
            const isOpen = open === m.modeIndex;
            return (
              <Fragment key={m.modeIndex}>
                <tr
                  className="cursor-pointer border-b border-zinc-100 hover:bg-indigo-50 dark:border-zinc-800/60 dark:hover:bg-indigo-950/40"
                  onClick={() => setOpen(isOpen ? null : m.modeIndex)}
                >
                  <td className="px-2 py-1.5">
                    <span className="mr-1 text-zinc-400">{isOpen ? "▾" : "▸"}</span>
                    {m.mode}
                  </td>
                  <td className="px-2 py-1.5 text-zinc-500">{roleLabel[def?.meleeRole ?? "other"]}</td>
                  <td className="num px-2 py-1.5 text-right">{fmt(m.perShot)}</td>
                  <td className="num px-2 py-1.5 text-right font-medium">{def?.meleeRole === "tennokai" ? "—" : fmt(m.burstDps)}</td>
                  <td className="num px-2 py-1.5 text-right">{m.comboMultiplier ? `${m.comboMultiplier}×` : ""}</td>
                  <td className="px-2 py-1.5">
                    <CoverageBadge c={m.coverage} />
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={6} className="p-2">
                      <ModeCard m={m} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OptimizerPanel({ state, onUndo }: { state: OptimizerState; onUndo: () => void }) {
  const result: OptimizeResult = state.result;
  return (
    <div className="card space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{state.label}</h3>
        <span className="text-sm text-zinc-500">
          {result.mode} · {fmt(result.burstDps)} {result.mode === "Heavy Attack" ? "heavy DPS" : "burst DPS"} · {fmt(result.fireRate)} shots/s
          {result.perCharge != null ? ` · ${fmt(result.perCharge)} per charge` : ""} · {result.evaluations.toLocaleString()} builds evaluated
        </span>
        <button className="ml-auto text-sm text-indigo-600 hover:underline" onClick={onUndo}>
          Undo (restore previous build)
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 text-xs text-zinc-500">
        {result.attackSpeed != null && (
          <span className={result.belowAttackSpeedFloor ? "text-amber-600" : ""}>
            attack speed {result.attackSpeed.toFixed(2)}
            {result.belowAttackSpeedFloor ? " (couldn't reach the floor)" : ""}
          </span>
        )}
        {result.rangeM != null && <span>range {result.rangeM.toFixed(2)} m</span>}
        {result.rangeCost != null && <span>range costs {pct(result.rangeCost)} DPS</span>}
        {result.drain != null && <span>capacity used {result.drain}</span>}
      </div>
      <p className="text-xs text-zinc-500">Applied to the editor. Marginal value = share of the optimized value lost if that piece is removed.</p>
      <div className="space-y-1">
        {result.marginal.map((m) => (
          <div key={m.label} className="flex items-center gap-2 text-sm">
            <span className="w-48 shrink-0 truncate" title={m.label}>
              {m.label}
            </span>
            <div className="h-2 flex-1 rounded bg-zinc-100 dark:bg-zinc-800">
              <div
                className={`h-2 rounded ${
                  m.kind === "riven" ? "bg-fuchsia-500" : m.kind === "arcane" ? "bg-amber-500" : m.kind === "evolution" ? "bg-teal-500" : "bg-indigo-500"
                }`}
                style={{ width: `${Math.min(100, Math.max(0, m.loss * 100))}%` }}
              />
            </div>
            <span className="num w-14 text-right">{pct(m.loss)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BuildEditor() {
  const { data, engine, build, setBuild, scenario, best } = useStore();
  const [copied, setCopied] = useState(false);
  const [opt, setOpt] = useState<OptimizerState | null>(null);
  const [comfort, setComfort] = useState<ComfortSettings>({ on: false, minAttackSpeed: 1.5, rangeTolerance: 0.05, maxFireRate: 9 });
  const [view, setViewState] = useState<ModView>(savedView);
  const setView = (v: ModView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // not persisted
    }
  };
  const weapon = data!.weapons.find((w) => w.id === build.weapon);

  const compatible = useMemo(() => {
    if (!weapon) return [] as Mod[];
    const ids = new Set<string>(JSON.parse(engine!.compatibleMods(weapon.id)));
    return data!.mods.filter((m) => ids.has(m.id) && m.modifiers.length).sort((a, b) => a.name.localeCompare(b.name));
  }, [weapon, data, engine]);
  const exilusOptions = compatible.filter((m) => m.isExilus);
  const arcanes = data!.arcanes.filter((a) => weapon && a.slot === weapon.slot);

  const used = new Set(build.slots.filter(Boolean));
  const setSlot = (i: number, id: string) => {
    const slots = [...build.slots];
    slots[i] = id;
    setBuild({ ...build, slots });
  };
  const hasRiven = build.riven.positives.length > 0;

  const result = useMemo(() => {
    if (!weapon) return null;
    return compute(engine!, engineBuild(data!, build, scenario), scenario.target);
  }, [engine, data, build, scenario, weapon]);

  const precomputed = weapon ? best?.targets[scenario.target.enemy ?? "raw"]?.[weapon.id] : undefined;

  return (
    <div className="grid gap-4 xl:grid-cols-[400px_1fr]">
      <div className="space-y-4">
        <div className="card space-y-3">
          <div>
            <label className="label">Weapon</label>
            <select
              className="field"
              value={build.weapon}
              onChange={(e) => {
                setOpt(null);
                setBuild({ weapon: e.target.value, slots: Array(SLOT_COUNT + 1).fill(""), arcane: null, riven: { positives: [], negative: null }, evolutions: [] });
              }}
            >
              <option value="">Choose a weapon…</option>
              {(["primary", "secondary", "melee", "archGun", "companion"] as const).map((slot) => (
                <optgroup key={slot} label={{ primary: "Primary", secondary: "Secondary", melee: "Melee", archGun: "Arch-gun", companion: "Companion" }[slot]}>
                  {data!.weapons
                    .filter((w) => w.slot === slot)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
          {weapon && (
            <>
              <OptimizerControls weapon={weapon} comfort={comfort} setComfort={setComfort} onResult={setOpt} />
              {precomputed?.plain && (
                <p className="text-[11px] text-zinc-500">
                  Precomputed theoretical best: {fmt(precomputed.plain.burstDps)}
                  {precomputed.riven ? ` / ${fmt(precomputed.riven.burstDps)} with riven` : ""}.
                </p>
              )}
              {view === "list" && (
              <div>
                <label className="label">
                  Mods <span className="normal-case">(slot order matters for elements)</span>
                </label>
                <div className="space-y-1.5">
                  {build.slots.slice(0, SLOT_COUNT).map((v, i) =>
                    hasRiven && i === RIVEN_SLOT ? (
                      <RivenSlot key={i} weapon={weapon} build={build} />
                    ) : (
                      <ModSlot key={i} label={`Slot ${i + 1}`} value={v} options={compatible} used={used} onChange={(id) => setSlot(i, id)} />
                    ),
                  )}
                  <ModSlot label="Exilus" value={build.slots[SLOT_COUNT]} options={exilusOptions} used={used} onChange={(id) => setSlot(SLOT_COUNT, id)} />
                </div>
              </div>
              )}
              <EvolutionPicker weapon={weapon} build={build} setBuild={setBuild} />
              {view === "list" && (
              <div>
                <label className="label">Arcane</label>
                <select className="field" value={build.arcane ?? ""} onChange={(e) => setBuild({ ...build, arcane: e.target.value || null })}>
                  <option value="">None</option>
                  {arcanes.map((a) => (
                    <option key={a.id} value={a.name} title={a.description}>
                      {a.name}
                      {!a.behaviour && !a.modifiers.length ? " (not modelled)" : ""}
                    </option>
                  ))}
                </select>
                {weapon.slot === "melee" || weapon.slot === "archGun" || weapon.slot === "companion" ? (
                  <p className="mt-1 text-[11px] text-zinc-500">No arcanes modelled for this slot yet.</p>
                ) : null}
              </div>
              )}
            </>
          )}
        </div>

        {weapon && <RivenEditor weapon={weapon} />}
        <SavedBuilds />
      </div>

      <div className="space-y-4">
        {!weapon && <p className="text-zinc-500">Pick a weapon, or click one in the weapon browser.</p>}
        {weapon && (
          <div className="flex flex-wrap items-center gap-3">
            {weapon.image && <img src={weapon.image} alt="" className="h-12 w-auto" onError={(e) => (e.currentTarget.style.display = "none")} />}
            <div>
              <h2 className="text-xl font-semibold">{weapon.name}</h2>
              <p className="text-xs capitalize text-zinc-500">
                {weapon.slot} · {weapon.class} · vs {result?.ok?.target ?? "—"}
              </p>
            </div>
            <button
              className="ml-auto rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              onClick={() => {
                navigator.clipboard.writeText(shareLink(build));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Link copied" : "Copy share link"}
            </button>
          </div>
        )}
        {weapon && (
          <div className="card space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">Build</h3>
              <span className="text-xs text-zinc-500">slot order matters for elements</span>
              <div className="ml-auto inline-flex rounded-md border border-zinc-300 p-0.5 text-xs dark:border-zinc-700" role="group" aria-label="Mod view">
                {(["cards", "list"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    aria-pressed={view === v}
                    className={`rounded px-2 py-0.5 capitalize ${view === v ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            {view === "cards" ? (
              <ModGrid weapon={weapon} build={build} setBuild={setBuild} compatible={compatible} arcanes={arcanes} />
            ) : (
              <p className="text-xs text-zinc-500">List view: edit mods and the arcane in the left column.</p>
            )}
          </div>
        )}
        {opt && opt.result.weaponId === weapon?.id && (
          <OptimizerPanel
            state={opt}
            onUndo={() => {
              setBuild(opt.previous);
              setOpt(null);
            }}
          />
        )}
        {weapon?.melee && <MeleeSummary weapon={weapon} build={build} comfortSpeed={comfort.minAttackSpeed} />}
        {result?.error && <div className="card text-red-600">{result.error.message}</div>}
        {result?.ok?.warnings.map((w) => (
          <p key={w} className="text-xs text-amber-700 dark:text-amber-400">
            {w}
          </p>
        ))}
        {weapon?.melee && result?.ok ? (
          <MeleeModeTable modes={result.ok.modes} weapon={weapon} />
        ) : (
          result?.ok?.modes.map((m) => <ModeCard key={m.modeIndex} m={m} />)
        )}
        {result?.ok?.failedModes.map((f) => (
          <div key={f.modeIndex} className="card">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{f.mode}</h3>
              <CoverageBadge c="unsupported" />
            </div>
            <p className="mt-1 text-sm text-zinc-500">{f.error.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
