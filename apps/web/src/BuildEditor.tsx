import { useMemo, useState } from "react";
import {
  buildFromBest,
  compute,
  engineBuild,
  fmt,
  optimizeInWorker,
  pct,
  scenarioBuild,
  shareLink,
  SLOT_COUNT,
  useStore,
} from "./store";
import { CoverageBadge, ExplainTree } from "./Common";
import RivenEditor from "./RivenEditor";
import type { EditorBuild, Mod, ModeResult, OptimizeResult } from "./types";

function modSummary(m: Mod) {
  const parts = m.modifiers.map((x) => {
    const val = `${x.value > 0 ? "+" : ""}${Math.round(x.value * 1000) / 10}%`;
    const what = x.stat.of ?? x.stat.kind;
    const per = x.per === "statusType" ? " per status" : x.per === "comboMultiplier" ? " per combo" : "";
    const cond = x.condition && x.condition !== "always" ? ` (${x.condition}${x.maxStacks && x.maxStacks > 1 ? ` ×${x.maxStacks}` : ""})` : "";
    return `${val} ${what}${per}${cond}`;
  });
  if (m.locksFireRate) parts.push("locks fire rate");
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
            {m.name} · {modSummary(m)}
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

function OptimizerPanel({ result, previous, onUndo }: { result: OptimizeResult; previous: EditorBuild | null; onUndo: () => void }) {
  return (
    <div className="card space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Theoretical best{result.riven.length ? " + riven" : ""}</h3>
        <span className="text-sm text-zinc-500">
          {result.mode} · {fmt(result.burstDps)} burst DPS · {result.evaluations.toLocaleString()} builds evaluated
        </span>
        {previous && (
          <button className="ml-auto text-sm text-indigo-600 hover:underline" onClick={onUndo}>
            Undo (restore previous build)
          </button>
        )}
      </div>
      <p className="text-xs text-zinc-500">Applied to the editor. Marginal value = DPS lost if that piece is removed.</p>
      <div className="space-y-1">
        {result.marginal.map((m) => (
          <div key={m.label} className="flex items-center gap-2 text-sm">
            <span className="w-48 shrink-0 truncate" title={m.label}>
              {m.label}
            </span>
            <div className="h-2 flex-1 rounded bg-zinc-100 dark:bg-zinc-800">
              <div
                className={`h-2 rounded ${m.kind === "riven" ? "bg-fuchsia-500" : m.kind === "arcane" ? "bg-amber-500" : "bg-indigo-500"}`}
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
  const [busy, setBusy] = useState<null | "plain" | "riven">(null);
  const [opt, setOpt] = useState<{ result: OptimizeResult; previous: EditorBuild } | null>(null);
  const [optError, setOptError] = useState<string | null>(null);
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
  const normalUsed = build.slots.slice(0, SLOT_COUNT).filter(Boolean).length;

  const result = useMemo(() => {
    if (!weapon) return null;
    return compute(engine!, engineBuild(data!, build, scenario), scenario.target);
  }, [engine, data, build, scenario, weapon]);

  const runOptimizer = async (riven: boolean) => {
    if (!weapon) return;
    setBusy(riven ? "riven" : "plain");
    setOptError(null);
    const r = await optimizeInWorker(weapon.id, scenarioBuild(data!, scenario), scenario.target, riven);
    setBusy(null);
    if (r.error || !r.ok) {
      setOptError(r.error?.message ?? "optimizer failed");
      return;
    }
    const previous = build;
    setBuild(buildFromBest(data!, weapon, r.ok));
    setOpt({ result: r.ok, previous });
  };

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
                setBuild({ weapon: e.target.value, slots: Array(SLOT_COUNT + 1).fill(""), arcane: null, riven: { positives: [], negative: null } });
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
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={!!busy}
                  onClick={() => runOptimizer(false)}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {busy === "plain" ? "Searching…" : "Best build (no riven)"}
                </button>
                <button
                  disabled={!!busy}
                  onClick={() => runOptimizer(true)}
                  className="rounded-md bg-fuchsia-600 px-3 py-1.5 text-sm text-white hover:bg-fuchsia-500 disabled:opacity-60"
                >
                  {busy === "riven" ? "Searching…" : "Best build + riven"}
                </button>
              </div>
              <p className="text-[11px] text-zinc-500">
                Searches all compatible mods, arcanes and (optionally) a max-roll riven for the highest burst DPS under the current scenario. Any polarity, no
                capacity limit.
                {precomputed?.plain && ` Precomputed best: ${fmt(precomputed.plain.burstDps)}${precomputed.riven ? ` / ${fmt(precomputed.riven.burstDps)} with riven` : ""}.`}
              </p>
              {optError && <p className="text-sm text-red-600">{optError}</p>}
              <div>
                <label className="label">
                  Mods <span className="normal-case">(slot order matters for elements{hasRiven ? "; the riven takes one slot" : ""})</span>
                </label>
                <div className="space-y-1.5">
                  {build.slots.slice(0, SLOT_COUNT).map((v, i) => (
                    <ModSlot key={i} label={`Slot ${i + 1}`} value={v} options={compatible} used={used} onChange={(id) => setSlot(i, id)} />
                  ))}
                  <ModSlot label="Exilus" value={build.slots[SLOT_COUNT]} options={exilusOptions} used={used} onChange={(id) => setSlot(SLOT_COUNT, id)} />
                </div>
                {hasRiven && normalUsed > SLOT_COUNT - 1 && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">8 mods plus a riven won't fit in game: clear one slot.</p>
                )}
              </div>
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
            </>
          )}
        </div>

        {weapon && <RivenEditor weapon={weapon} />}
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
        {opt && opt.result.weaponId === weapon?.id && (
          <OptimizerPanel
            result={opt.result}
            previous={opt.previous}
            onUndo={() => {
              setBuild(opt.previous);
              setOpt(null);
            }}
          />
        )}
        {result?.error && <div className="card text-red-600">{result.error.message}</div>}
        {result?.ok?.warnings.map((w) => (
          <p key={w} className="text-xs text-amber-700 dark:text-amber-400">
            {w}
          </p>
        ))}
        {result?.ok?.modes.map((m) => <ModeCard key={m.modeIndex} m={m} />)}
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
