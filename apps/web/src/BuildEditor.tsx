import { useMemo, useState } from "react";
import { compute, fmt, shareLink, useStore } from "./store";
import { CoverageBadge, EnemyPicker, ExplainTree } from "./Common";
import type { Mod, ModeResult, Modifier, Stat } from "./types";

const SLOT_COUNT = 8;

const RIVEN_STATS: [string, Stat][] = [
  ["Damage", { kind: "baseDamage" }],
  ["Multishot", { kind: "multishot" }],
  ["Critical Chance", { kind: "critChance" }],
  ["Critical Damage", { kind: "critDamage" }],
  ["Status Chance", { kind: "statusChance" }],
  ["Fire Rate", { kind: "fireRate" }],
  ["Magazine", { kind: "magazine" }],
  ["Reload Speed", { kind: "reloadSpeed" }],
  ["Impact", { kind: "physical", of: "impact" }],
  ["Puncture", { kind: "physical", of: "puncture" }],
  ["Slash", { kind: "physical", of: "slash" }],
  ["Heat", { kind: "element", of: "heat" }],
  ["Cold", { kind: "element", of: "cold" }],
  ["Electricity", { kind: "element", of: "electricity" }],
  ["Toxin", { kind: "element", of: "toxin" }],
  ["Damage to Grineer", { kind: "factionDamage", of: "grineer" }],
  ["Damage to Corpus", { kind: "factionDamage", of: "corpus" }],
  ["Damage to Infested", { kind: "factionDamage", of: "infested" }],
];
const statKey = (s: Stat) => `${s.kind}:${s.of ?? ""}`;

function modSummary(m: Mod) {
  const parts = m.modifiers.map((x) => {
    const pct = `${x.value > 0 ? "+" : ""}${Math.round(x.value * 1000) / 10}%`;
    const what = x.stat.of ?? x.stat.kind;
    return `${pct} ${what}${x.condition && x.condition !== "always" ? ` (${x.condition})` : ""}`;
  });
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

export default function BuildEditor() {
  const { data, engine, build, setBuild, target, setTarget } = useStore();
  const [copied, setCopied] = useState(false);
  const weapon = data!.weapons.find((w) => w.id === build.weapon);

  const compatible = useMemo(() => {
    if (!weapon) return [] as Mod[];
    const ids = new Set<string>(JSON.parse(engine!.compatibleMods(weapon.id)));
    return data!.mods.filter((m) => ids.has(m.id) && m.modifiers.length).sort((a, b) => a.name.localeCompare(b.name));
  }, [weapon, data, engine]);
  const exilusOptions = compatible.filter((m) => m.isExilus);
  const arcanes = data!.arcanes.filter((a) => weapon && a.slot === weapon.slot);

  const slots = [...build.mods.slice(0, SLOT_COUNT + 1)];
  while (slots.length < SLOT_COUNT + 1) slots.push("");
  const used = new Set(slots.filter(Boolean));
  const setSlot = (i: number, id: string) => {
    const next = [...slots];
    next[i] = id;
    setBuild({ ...build, mods: next.filter((_, j) => j <= SLOT_COUNT).map((x) => x) });
  };

  const result = useMemo(() => {
    if (!weapon) return null;
    return compute(engine!, { ...build, mods: build.mods.filter(Boolean) }, target);
  }, [engine, build, target, weapon]);

  const setRiven = (riven: Modifier[]) => setBuild({ ...build, riven });

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <div className="card space-y-3">
          <div>
            <label className="label">Weapon</label>
            <select className="field" value={build.weapon} onChange={(e) => setBuild({ ...build, weapon: e.target.value, mods: [], arcane: null })}>
              <option value="">Choose a weapon…</option>
              {[...data!.weapons]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </select>
          </div>
          {weapon && (
            <>
              <div>
                <label className="label">Mods (slot order matters for elements)</label>
                <div className="space-y-1.5">
                  {slots.slice(0, SLOT_COUNT).map((v, i) => (
                    <ModSlot key={i} label={`Slot ${i + 1}`} value={v} options={compatible} used={used} onChange={(id) => setSlot(i, id)} />
                  ))}
                  <ModSlot label="Exilus" value={slots[SLOT_COUNT]} options={exilusOptions} used={used} onChange={(id) => setSlot(SLOT_COUNT, id)} />
                </div>
              </div>
              <div>
                <label className="label">Arcane</label>
                <select className="field" value={build.arcane ?? ""} onChange={(e) => setBuild({ ...build, arcane: e.target.value || null })}>
                  <option value="">None</option>
                  {arcanes.map((a) => (
                    <option key={a.id} value={a.id} title={a.description}>
                      {a.name}
                      {!a.behaviour && !a.modifiers.length ? " (not modelled)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {weapon && (
          <div className="card space-y-2">
            <label className="label">Riven (values in %)</label>
            {[0, 1, 2, 3].map((i) => {
              const r = build.riven[i];
              return (
                <div key={i} className="flex gap-2">
                  <select
                    className="field"
                    value={r ? statKey(r.stat) : ""}
                    onChange={(e) => {
                      const next = [...build.riven];
                      const found = RIVEN_STATS.find(([, s]) => statKey(s) === e.target.value);
                      if (!found) next.splice(i, 1);
                      else next[i] = { source: `Riven ${found[0]}`, stat: found[1], value: r?.value ?? (i === 3 ? -0.5 : 1) };
                      setRiven(next.filter(Boolean));
                    }}
                  >
                    <option value="">{i === 3 ? "— negative —" : `— stat ${i + 1} —`}</option>
                    {RIVEN_STATS.map(([l, s]) => (
                      <option key={statKey(s)} value={statKey(s)}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="field w-24"
                    disabled={!r}
                    value={r ? Math.round(r.value * 1000) / 10 : ""}
                    onChange={(e) => {
                      const next = [...build.riven];
                      next[i] = { ...r!, value: Number(e.target.value) / 100 };
                      setRiven(next);
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="card space-y-3">
          <div>
            <label className="label">Enemy</label>
            <EnemyPicker />
          </div>
          <Slider label="External armor strip" value={target.armorStrip} onChange={(v) => setTarget({ ...target, armorStrip: v })} />
          <Slider
            label="Conditional uptime (on-kill / on-headshot stacks)"
            value={build.conditions.conditionalUptime}
            onChange={(v) => setBuild({ ...build, conditions: { ...build.conditions, conditionalUptime: v } })}
          />
          <Slider
            label="Headshot share"
            value={build.conditions.headshotShare}
            onChange={(v) => setBuild({ ...build, conditions: { ...build.conditions, headshotShare: v } })}
          />
        </div>
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

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="label flex justify-between">
        <span>{label}</span>
        <span className="num">{Math.round(value * 100)}%</span>
      </label>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-indigo-600" />
    </div>
  );
}
