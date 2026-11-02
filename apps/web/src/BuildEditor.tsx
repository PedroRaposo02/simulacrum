import { Fragment, useMemo, useState } from "react";
import { usePersistent } from "./persist";
import { compute, engineBuild, fmt, pct, RIVEN_SLOT, shareLink, SLOT_COUNT, useStore } from "./store";
import { formatRivenValue, layoutOf, rivenType, rowValue } from "./riven";
import { CoverageBadge, ExplainTree } from "./Common";
import RivenEditor from "./RivenEditor";
import MeleeSummary from "./MeleeSummary";
import OptimizerControls, { type ComfortSettings, type OptimizerState } from "./OptimizerControls";
import SavedBuilds from "./SavedBuilds";
import { weaponTypeLabel } from "./labels";
import { buildJson, buildMarkdown } from "./exportBuild";
import { Star, useFavorites } from "./favorites";
import { downloadJson } from "./store";
import ModGrid, { arcaneModelled, modSummary as cardSummary } from "./ModGrid";

type ModView = "cards" | "list";
const VIEW_KEY = "simulacrum.modView";
const STATS_KEY = "simulacrum.liveStats";
const SHARE_KEY = "simulacrum.shareVsEnemy";
function savedLiveStats(): boolean {
  try {
    return localStorage.getItem(STATS_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Compact live stats shown next to the mod cards. */
function LiveStats({ m }: { m: ModeResult }) {
  const tile = (label: string, v: number | null | undefined) => (
    <div className="rounded-md bg-zinc-100 px-2 py-1.5 dark:bg-zinc-800/60">
      <div className="text-[10px] uppercase text-zinc-500">{label}</div>
      <div className="num text-base font-semibold">{v == null ? "—" : fmt(v)}</div>
    </div>
  );
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800 lg:sticky lg:top-2 lg:self-start">
      <div className="text-xs font-semibold">{m.mode}</div>
      <div className="grid grid-cols-2 gap-1.5">
        {tile("Per shot", m.perShot)}
        {tile("Burst DPS", m.burstDps)}
        {tile("Sustained DPS", m.sustainedDps)}
        {m.perCharge != null ? tile("Per charge", m.perCharge) : tile("Status DPS", m.statusDps)}
        {tile("Group DPS", m.groupDps)}
        {tile("Group sustained", m.groupSustainedDps)}
      </div>
      <StatSheet m={m} />
    </div>
  );
}
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

const TYPE_LABEL: Record<string, string> = {
  impact: "Impact", puncture: "Puncture", slash: "Slash", heat: "Heat", cold: "Cold", electricity: "Electricity", toxin: "Toxin",
  blast: "Blast", radiation: "Radiation", gas: "Gas", magnetic: "Magnetic", viral: "Viral", corrosive: "Corrosive", void: "Void", tau: "Tau", true: "True",
};

/** Arsenal-style stat list for one attack mode. */
function StatSheet({ m }: { m: ModeResult }) {
  const row = (label: string, value: string) => (
    <div key={label} className="flex justify-between gap-3 border-b border-zinc-100 py-0.5 dark:border-zinc-800">
      <span className="text-zinc-500">{label}</span>
      <span className="num font-medium">{value}</span>
    </div>
  );
  const general: [string, string][] = [
    [m.attackSpeed != null ? "Attack speed" : "Fire rate", m.attackSpeed != null ? m.attackSpeed.toFixed(2) : `${m.fireRate.toFixed(2)} /s`],
    ...(m.magazine != null ? ([["Magazine", String(m.magazine)], ["Reload", `${m.reloadS.toFixed(2)} s`]] as [string, string][]) : []),
    ...(m.rangeM != null ? ([["Range", `${m.rangeM.toFixed(2)} m`]] as [string, string][]) : []),
    ...(m.comboMultiplier != null ? ([["Combo multiplier", `${m.comboMultiplier}×`]] as [string, string][]) : []),
    ["Viral stacks on target", m.viralStacks.toFixed(1)],
    ["Corrosive stacks on target", m.corrosiveStacks.toFixed(1)],
  ];
  return (
    <div className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
      {m.components.map((c) => {
        const total = Object.values(c.damage).reduce((a, b) => a + b, 0);
        return (
          <div key={c.name}>
            <div className="mb-1 font-semibold text-zinc-600 dark:text-zinc-300">{m.components.length > 1 ? c.name : "Damage (per projectile, before enemy)"}</div>
            {Object.entries(c.damage)
              .sort((a, b) => b[1] - a[1])
              .map(([t, v]) => row(TYPE_LABEL[t] ?? t, fmt(v)))}
            {row("Total", fmt(total))}
            {row("Critical chance", `${(c.critChance * 100).toFixed(1)}%`)}
            {row("Critical multiplier", `${c.critMult.toFixed(2)}×`)}
            {row("Status chance", `${(c.statusChance * 100).toFixed(1)}%`)}
            {row("Projectiles (multishot)", c.projectiles.toFixed(2))}
          </div>
        );
      })}
      <div>
        <div className="mb-1 font-semibold text-zinc-600 dark:text-zinc-300">General</div>
        {general.map(([l, v]) => row(l, v))}
      </div>
    </div>
  );
}

const STATUS_HELP =
  "Damage per second from status effects on the target (Bleed, Burn, Toxin, Gas, Electricity, Blast), already included in burst and sustained DPS.";
const GROUP_HELP =
  "Damage per second to a whole group (Scenario › Conditions › group size): explosions and melee swings (with follow-through) reach part of the group by radius or range; Gas, Electricity, Blast detonations and Melee Influence spread too.";
const BURST_HELP = "Burst DPS: damage per second while firing continuously, ignoring reloads.";
const SUSTAINED_HELP =
  "Sustained DPS: average over a full cycle of emptying the magazine and reloading (for Incarnon forms, the charge; recharge time isn't modelled, so it equals burst).";

function ModeCard({ m, body, head }: { m: ModeResult; body?: ModeResult; head?: ModeResult }) {
  const b = body ?? m;
  const tile = (label: string, v: number | null | undefined, help?: string) => (
    <div key={label} className="rounded-md bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60" title={help}>
      <div className="text-[11px] uppercase text-zinc-500">
        {label}
        {help ? " ⓘ" : ""}
      </div>
      <div className="num text-lg font-semibold">{v == null ? "—" : fmt(v)}</div>
    </div>
  );
  const row = (title: string, r: ModeResult) => (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{title}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {tile("Per shot", r.perShot)}
        {tile("Burst DPS", r.burstDps, BURST_HELP)}
        {tile("Sustained DPS", r.sustainedDps, SUSTAINED_HELP)}
        {m.perCharge != null ? tile("Per Incarnon charge", r.perCharge) : tile("Status DPS", r.statusDps, STATUS_HELP)}
        {tile("Group DPS", r.groupDps, GROUP_HELP)}
        {tile("Group sustained", r.groupSustainedDps, GROUP_HELP)}
      </div>
    </div>
  );
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{m.mode}</h3>
        <CoverageBadge c={m.coverage} />
        <span className="num ml-auto text-xs text-zinc-500">
          {fmt(m.fireRate)} shots/s · mag {m.magazine ?? "—"} · reload {fmt(m.reloadS)}s
        </span>
      </div>
      {row("Bodyshots", b)}
      {head && row("Headshots", head)}
      <p className="text-[11px] text-zinc-500">
        Burst = while firing, no reloads. Sustained = averaged over magazine + reload. Headshots only apply to attacks that can headshot (explosions can&apos;t).
      </p>
      {m.approximations.length > 0 && (
        <ul className="list-inside list-disc text-xs text-amber-700 dark:text-amber-400">
          {m.approximations.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <details open>
        <summary className="cursor-pointer text-sm text-indigo-600">Stats</summary>
        <div className="mt-2">
          <StatSheet m={b} />
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm text-indigo-600">How this number is computed</summary>
        <div className="mt-2 border-l border-zinc-200 pl-2 dark:border-zinc-700">
          <ExplainTree node={m.explain} />
        </div>
      </details>
    </div>
  );
}

/** Companion weapon thresholds: Tenacious Bond (crit >= 50%) and what Contagious Bond would spread. */
function CompanionSummary({ m }: { m: ModeResult }) {
  const cc = Math.max(...m.components.map((c) => c.critChance));
  const ok = cc >= 0.5 - 1e-9;
  const spread = (n: number) => (n >= 2 ? Math.floor(n / 2) : 0);
  const badge = ok
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300"
    : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300";
  return (
    <div className="card space-y-2 text-sm">
      <h3 className="font-semibold">Companion bonds</h3>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${badge}`}>{ok ? "Tenacious Bond active" : "Tenacious Bond inactive"}</span>
        <span className="text-zinc-500">
          crit chance {(cc * 100).toFixed(1)}% (needs 50% or more). When active, your own weapons get +1.2× final crit multiplier: enable Tenacious Bond in Scenario › Damage buffs.
        </span>
      </div>
      <p className="text-zinc-500">
        Contagious Bond: when this companion kills an enemy, half of each status with 2+ stacks spreads within 9 m. At this build&apos;s steady state that is Viral{" "}
        {spread(m.viralStacks)} and Corrosive {spread(m.corrosiveStacks)} stacks per spread.
      </p>
      <p className="text-[11px] text-zinc-500">Companion AI doesn&apos;t aim or reliably headshot, so aim-only mods and headshot-triggered effects are ignored for this weapon.</p>
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
      <p className="text-xs text-zinc-500">
        Applied to the editor. Marginal value = how much each piece adds on top of the rest (additive bonuses share a pool, so +360% base damage adds less
        than +360% when other base damage mods are present).
      </p>
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
                title={`${pct(m.loss)} of the DPS is lost without it`}
              />
            </div>
            <span className="num w-16 text-right">{m.loss >= 1 - 1e-9 ? "needed" : `+${pct(1 / (1 - m.loss) - 1)}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FavStar({ id, name }: { id: string; name: string }) {
  const favs = useFavorites();
  return <Star on={favs.weapons.includes(id)} onClick={() => favs.toggleWeapon(id)} label={name} />;
}

export default function BuildEditor() {
  const { data, engine, build, setBuild, scenario, best } = useStore();
  const [copied, setCopied] = useState(false);
  const [opt, setOpt] = useState<OptimizerState | null>(null);
  const [comfort, setComfort] = usePersistent<ComfortSettings>("opt.comfort", { on: false, minAttackSpeed: 1.5, rangeTolerance: 0.05, maxFireRateBonus: 1.5 });
  const [view, setViewState] = useState<ModView>(savedView);
  const [liveStats, setLiveStatsState] = useState<boolean>(savedLiveStats);
  const [shareVsEnemy, setShareVsEnemyState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SHARE_KEY) === "on";
    } catch {
      return false;
    }
  });
  const setShareVsEnemy = (on: boolean) => {
    setShareVsEnemyState(on);
    try {
      localStorage.setItem(SHARE_KEY, on ? "on" : "off");
    } catch {
      // not persisted
    }
  };
  const setLiveStats = (on: boolean) => {
    setLiveStatsState(on);
    try {
      localStorage.setItem(STATS_KEY, on ? "on" : "off");
    } catch {
      // not persisted
    }
  };
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
  const arcanes = data!.arcanes.filter((a) => weapon && a.slot === weapon.slot && (!a.classes?.length || a.classes.includes(weapon.class)));

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
  // Bodyshot and headshot views (headshot share 0 and 1), whatever the scenario's share is.
  const [bodyRes, headRes] = useMemo(() => {
    if (!weapon) return [null, null];
    const at = (share: number) => {
      const s2 = { ...scenario, conditions: { ...scenario.conditions, headshotShare: share } };
      return compute(engine!, engineBuild(data!, build, s2), s2.target).ok ?? null;
    };
    return [at(0), weapon.slot === "companion" ? null : at(1)];
  }, [engine, data, build, scenario, weapon]);
  const forMode = (r: { modes: ModeResult[] } | null, i: number) => r?.modes.find((x) => x.modeIndex === i);
  // The build's main attack: the headline mode with the most burst DPS (bodyshots).
  const mainMode = useMemo(() => {
    if (!weapon || !bodyRes) return null;
    const headline = bodyRes.modes.filter((m) => weapon.modes[m.modeIndex]?.headline !== false);
    const pool = headline.length ? headline : bodyRes.modes;
    return pool.reduce<ModeResult | null>((a, m) => (!a || m.burstDps > a.burstDps ? m : a), null);
  }, [weapon, bodyRes]);
  // DPS each mod / the riven / the arcane adds, on the main attack. By default on the weapon's raw
  // damage (no enemy armor, no Viral or other status multipliers); optionally against the scenario enemy.
  const contributions = useMemo(() => {
    if (!weapon || !mainMode || !(mainMode.burstDps > 0)) return null;
    const s0 = { ...scenario, conditions: { ...scenario.conditions, headshotShare: 0 } };
    const val = (b: typeof build) => {
      const m = compute(engine!, engineBuild(data!, b, s0), s0.target).ok?.modes.find((x) => x.modeIndex === mainMode.modeIndex);
      return (shareVsEnemy ? m?.burstDps : m?.burstDpsRaw) ?? 0;
    };
    const base = val(build);
    if (!(base > 0)) return null;
    const out: Record<string, number> = {};
    // Gain = how much DPS this piece adds on top of everything else (base / without - 1).
    const gain = (without: number) => (without > 0 ? Math.max(0, base / without - 1) : Infinity);
    build.slots.forEach((id, i) => {
      if (id) out[String(i)] = gain(val({ ...build, slots: build.slots.map((x, j) => (j === i ? "" : x)) }));
    });
    if (build.riven.positives.length) out.riven = gain(val({ ...build, riven: { positives: [], negative: null } }));
    if (build.arcane) out.arcane = gain(val({ ...build, arcane: null }));
    return out;
  }, [engine, data, build, scenario, weapon, mainMode, shareVsEnemy]);

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
                setBuild({ weapon: e.target.value, slots: Array(SLOT_COUNT + 1).fill(""), arcane: null, riven: { positives: [], negative: null }, evolutions: [], progenitor: null });
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
                  Precomputed Most DPS build: {fmt(precomputed.plain.burstDps)}
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
              {weapon.progenitor && (
                <div>
                  <label className="label">Progenitor element (60%)</label>
                  <select className="field" value={build.progenitor ?? ""} onChange={(e) => setBuild({ ...build, progenitor: e.target.value || null })}>
                    <option value="">None</option>
                    {["impact", "heat", "cold", "electricity", "toxin", "magnetic", "radiation"].map((t) => (
                      <option key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-zinc-500">Innate bonus element of a Kuva Lich / Sister weapon; combines after mod elements.</p>
                </div>
              )}
              {view === "list" && (
              <div>
                <label className="label">Arcane</label>
                <select className="field" value={build.arcane ?? ""} onChange={(e) => setBuild({ ...build, arcane: e.target.value || null })}>
                  <option value="">None</option>
                  {arcanes.map((a) => (
                    <option key={a.id} value={a.name} title={a.description}>
                      {a.name}
                      {!arcaneModelled(a) ? " (not modelled)" : ""}
                    </option>
                  ))}
                </select>
                {weapon.slot === "archGun" || weapon.slot === "companion" ? (
                  <p className="mt-1 text-[11px] text-zinc-500">This weapon type has no arcane slot in the game.</p>
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
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                {weapon.name}
                <FavStar id={weapon.id} name={weapon.name} />
              </h2>
              <p className="text-xs text-zinc-500">
                <span className="capitalize">{weapon.slot}</span> · {weaponTypeLabel(weapon)} · vs {result?.ok?.target ?? "—"}
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
            <select
              className="field w-auto py-1.5 text-sm"
              value=""
              aria-label="Export build"
              onChange={(e) => {
                const kind = e.target.value;
                e.target.value = "";
                const name = `${weapon.name} build`;
                const slug = weapon.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                const note = `${scenario.target.enemy ?? "raw target"} · conditional uptime ${Math.round(scenario.conditions.conditionalUptime * 100)}%`;
                if (kind === "json" || kind === "both") downloadJson(`${slug}.json`, buildJson(name, build));
                if (kind === "md" || kind === "both") {
                  const md = buildMarkdown(data!, weapon, build, result?.ok, note);
                  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${slug}.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                }
              }}
            >
              <option value="" disabled>
                Export…
              </option>
              <option value="json">JSON (re-importable)</option>
              <option value="md">Markdown</option>
              <option value="both">Both</option>
            </select>
          </div>
        )}
        {weapon && (
          <div className="card space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">Build</h3>
              <span className="text-xs text-zinc-500">slot order matters for elements</span>
              <label className="ml-auto flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                <input type="checkbox" className="accent-indigo-600" checked={liveStats} onChange={(e) => setLiveStats(e.target.checked)} />
                Stats
              </label>
              <label
                className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300"
                title="Card percentages: off = the weapon's raw damage (no armor, Viral or other status); on = against the scenario enemy, including the Viral/Corrosive/Heat the build applies itself"
              >
                <input type="checkbox" className="accent-indigo-600" checked={shareVsEnemy} onChange={(e) => setShareVsEnemy(e.target.checked)} />
                % vs enemy
              </label>
              <div className="inline-flex rounded-md border border-zinc-300 p-0.5 text-xs dark:border-zinc-700" role="group" aria-label="Mod view">
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
            <div className={liveStats && mainMode ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]" : ""}>
              {view === "cards" ? (
                <ModGrid
                  weapon={weapon}
                  build={build}
                  setBuild={setBuild}
                  compatible={compatible}
                  arcanes={arcanes}
                  contributions={contributions}
                  vsEnemy={shareVsEnemy}
                />
              ) : (
                <p className="text-xs text-zinc-500">List view: edit mods and the arcane in the left column.</p>
              )}
              {liveStats && mainMode && <LiveStats m={mainMode} />}
            </div>
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
        {weapon?.slot === "companion" && result?.ok?.modes[0] && <CompanionSummary m={result.ok.modes[0]} />}
        {result?.error && <div className="card text-red-600">{result.error.message}</div>}
        {result?.ok?.warnings.map((w) => (
          <p key={w} className="text-xs text-amber-700 dark:text-amber-400">
            {w}
          </p>
        ))}
        {weapon?.melee && result?.ok ? (
          <MeleeModeTable modes={result.ok.modes} weapon={weapon} />
        ) : (
          result?.ok?.modes.map((m) => <ModeCard key={m.modeIndex} m={m} body={forMode(bodyRes, m.modeIndex)} head={forMode(headRes, m.modeIndex)} />)
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
