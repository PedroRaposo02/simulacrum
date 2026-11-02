import { useMemo, useState, type ReactNode } from "react";
import { Slider, Toggle } from "./Common";
import { buffBaseValue, userDefaultScenario, useStore } from "./store";
import type { Conditions, Target } from "./types";

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-zinc-200 pt-3 first:border-0 first:pt-0 dark:border-zinc-800">
      <button onClick={() => setOpen(!open)} className="mb-2 flex w-full items-center justify-between text-sm font-semibold">
        {title}
        <span className="text-zinc-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  );
}

/** Shared enemy, outsourced status, buffs and conditions: applies to the browser and the editor. */
export default function ScenarioPanel() {
  const { data, scenario, setScenario, build } = useStore();
  const { target, conditions } = scenario;
  // Situational triggers anywhere in the data, and the ones the open weapon can use.
  const { allTriggers, weaponTriggers } = useMemo(() => {
    const of = (mods: { trigger?: string }[] | undefined) => (mods ?? []).flatMap((m) => (m.trigger ? [m.trigger] : []));
    const all = new Set<string>();
    for (const w of data!.weapons) for (const t of w.evolutions ?? []) for (const o of t.options) of(o.modifiers).forEach((x) => all.add(x));
    for (const a of data!.arcanes) of(a.modifiers).forEach((x) => all.add(x));
    const weapon = data!.weapons.find((w) => w.id === build.weapon);
    const mine = new Set<string>();
    for (const t of weapon?.evolutions ?? []) for (const o of t.options) of(o.modifiers).forEach((x) => mine.add(x));
    for (const a of data!.arcanes) if (weapon && a.slot === weapon.slot) of(a.modifiers).forEach((x) => mine.add(x));
    return { allTriggers: [...all].sort(), weaponTriggers: mine };
  }, [data, build.weapon]);
  const triggers = conditions.triggers ?? [];
  const setTrigger = (t: string, on: boolean) => setC({ triggers: on ? [...triggers, t] : triggers.filter((x) => x !== t) });
  const sortedTriggers = [...allTriggers].sort((a, b) => Number(weaponTriggers.has(b)) - Number(weaponTriggers.has(a)));
  const setT = (t: Partial<Target>) => setScenario({ ...scenario, target: { ...target, ...t } });
  const setC = (c: Partial<Conditions>) => setScenario({ ...scenario, conditions: { ...conditions, ...c } });

  return (
    <aside className="card space-y-3 self-start">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scenario</h2>
        <button className="text-xs text-indigo-600 hover:underline" onClick={() => setScenario(userDefaultScenario())}
          title="Back to your default scenario (Settings), or the built-in one">
          Reset
        </button>
      </div>

      <Section title="Enemy">
        <select className="field" value={target.enemy ?? ""} onChange={(e) => setT({ enemy: e.target.value || null })}>
          <option value="">Raw (unarmored target)</option>
          {data!.enemies.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <Slider
          label="Corrosive Projection auras"
          value={target.corrosiveProjection ?? 0}
          min={0}
          max={4}
          step={1}
          display={`${target.corrosiveProjection ?? 0} (−${(target.corrosiveProjection ?? 0) * 18}% armor)`}
          onChange={(v) => setT({ corrosiveProjection: v })}
          disabled={!target.enemy}
        />
        <Slider label="Other armor strip (abilities…)" value={target.armorStrip} onChange={(v) => setT({ armorStrip: v })} disabled={!target.enemy} />
        <label className="block text-xs text-zinc-500">
          Enemy health (one enemy; sets kill rate in group fights)
          <input
            type="number"
            min={0}
            step={10000}
            className="field mt-1"
            placeholder={String(data!.enemies.find((e) => e.id === target.enemy)?.health ?? "unknown: no kills")}
            value={target.health ?? ""}
            onChange={(e) => setT({ health: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
          />
        </label>
      </Section>

      <Section title="Outsourced status">
        <p className="text-xs text-zinc-500">From teammates or abilities. The weapon's own procs still count if they're higher.</p>
        <Toggle label="Outsourced Viral" checked={target.viralStacks != null} onChange={(on) => setT({ viralStacks: on ? 10 : null })} />
        {target.viralStacks != null && (
          <Slider
            label="Viral stacks"
            value={target.viralStacks}
            min={0}
            max={10}
            step={1}
            display={`${target.viralStacks} (×${target.viralStacks >= 1 ? (2 + 0.25 * (target.viralStacks - 1)).toFixed(2) : "1.00"})`}
            onChange={(v) => setT({ viralStacks: v })}
          />
        )}
        <Toggle label="Outsourced Corrosive" checked={target.corrosiveStacks != null} onChange={(on) => setT({ corrosiveStacks: on ? 10 : null })} />
        {target.corrosiveStacks != null && (
          <Slider
            label="Corrosive stacks"
            value={target.corrosiveStacks}
            min={0}
            max={10}
            step={1}
            display={`${target.corrosiveStacks} (−${target.corrosiveStacks >= 1 ? Math.round(Math.min(0.8, 0.26 + 0.06 * (target.corrosiveStacks - 1)) * 100) : 0}% armor)`}
            onChange={(v) => setT({ corrosiveStacks: v })}
          />
        )}
        <Toggle label="Outsourced Heat (−50% armor)" checked={target.heatActive} onChange={(on) => setT({ heatActive: on })} />
      </Section>

      <Section title="Damage buffs">
        <Slider
          label="Ability strength"
          value={scenario.strength}
          min={0.5}
          max={4}
          step={0.05}
          onChange={(v) => setScenario({ ...scenario, strength: v })}
        />
        {data!.buffs.map((b) => {
          const st = scenario.buffs[b.id] ?? { on: false, value: null };
          const base = buffBaseValue(b, st);
          const effective = base * (b.scalesWithStrength ? scenario.strength : 1);
          const setB = (next: Partial<typeof st>) => setScenario({ ...scenario, buffs: { ...scenario.buffs, [b.id]: { ...st, ...next } } });
          return (
            <div key={b.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <label className="flex min-w-0 cursor-pointer items-start gap-2 text-sm" title={b.note}>
                <input type="checkbox" checked={st.on} onChange={(e) => setB({ on: e.target.checked })} className="mt-1 shrink-0 accent-indigo-600" />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate">{b.name}</span>
                  <span className="block truncate text-xs text-zinc-500">{st.subsumed ? "Helminth (subsumed)" : b.source}</span>
                </span>
              </label>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  className="field w-16 px-1.5 py-1 text-right"
                  title={`Value at 100% strength (${b.scalesWithStrength ? `×${scenario.strength.toFixed(2)} strength → ${Math.round(effective * 100)}%` : "doesn't scale with strength"})`}
                  value={Math.round(base * 1000) / 10}
                  onChange={(e) => setB({ value: Number(e.target.value) / 100 })}
                  aria-label={`${b.name} value`}
                />
                <span className="text-xs text-zinc-500">%</span>
              </span>
              {b.subsumedValue != null && (
                <label className="col-span-2 -mt-1 ml-6 flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500">
                  <input
                    type="checkbox"
                    className="accent-indigo-600"
                    checked={!!st.subsumed}
                    onChange={(e) => setB({ subsumed: e.target.checked, value: null })}
                  />
                  Subsumed (Helminth, {Math.round(b.subsumedValue * 100)}% base)
                </label>
              )}
            </div>
          );
        })}
        <p className="text-xs text-zinc-500">Values are at 100% strength; hover for the scaled value. Defaults need in-game checks.</p>
      </Section>

      <Section title="Situational triggers" defaultOpen={false}>
        <p className="text-xs text-zinc-500">
          Bonuses that need a particular loadout or play style. Off by default (best builds assume them off); turn on the ones your setup keeps up.
        </p>
        {sortedTriggers.map((t) => (
          <label key={t} className="flex items-center gap-2 text-xs">
            <input type="checkbox" className="accent-indigo-600" checked={triggers.includes(t)} onChange={(e) => setTrigger(t, e.target.checked)} />
            <span className={weaponTriggers.has(t) ? "" : "text-zinc-500"}>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
            {weaponTriggers.has(t) && <span className="rounded bg-indigo-600/15 px-1 text-[10px] text-indigo-500">this weapon</span>}
          </label>
        ))}
      </Section>

      <Section title="Conditions" defaultOpen={false}>
        <Slider
          label="Group fight: enemies"
          value={conditions.groupSize ?? 5}
          min={1}
          max={12}
          step={1}
          display={String(conditions.groupSize ?? 5)}
          onChange={(v) => setC({ groupSize: v })}
        />
        <Slider
          label="Fight length (Heat stacks grow while refreshed)"
          value={conditions.fightS ?? 15}
          min={0}
          max={60}
          step={5}
          display={`${conditions.fightS ?? 15} s`}
          onChange={(v) => setC({ fightS: v })}
        />
        <Slider
          label="Distance to target (damage falloff)"
          value={conditions.engagementM ?? 10}
          min={0}
          max={50}
          step={1}
          display={`${conditions.engagementM ?? 10} m`}
          onChange={(v) => setC({ engagementM: v })}
        />
        <Toggle
          label="Contagious Bond (companion kills spread half of each status within 9 m)"
          checked={conditions.contagiousBond ?? false}
          onChange={(v) => setC({ contagiousBond: v })}
        />
        <Slider
          label="Incarnon charging: weak point hit share"
          value={conditions.incarnonChargeShare ?? 0.5}
          onChange={(v) => setC({ incarnonChargeShare: Math.max(0.05, v) })}
        />
        <Slider label="Conditional uptime (on-kill stacks…)" value={conditions.conditionalUptime} onChange={(v) => setC({ conditionalUptime: v })} />
        <Toggle label="Headshot-triggered effects active" checked={conditions.headshotEffects} onChange={(v) => setC({ headshotEffects: v })} />
        <Slider label="Headshot share" value={conditions.headshotShare} onChange={(v) => setC({ headshotShare: v })} />
        <Slider
          label="Status types on target"
          value={conditions.statusTypes}
          min={0}
          max={10}
          step={1}
          display={String(conditions.statusTypes)}
          onChange={(v) => setC({ statusTypes: v })}
        />
        <Slider
          label="Light attack combo (Tennokai uses it too)"
          value={conditions.comboMultiplier}
          min={1}
          max={12}
          step={0.5}
          display={`${conditions.comboMultiplier}×`}
          onChange={(v) => setC({ comboMultiplier: v })}
        />
        <Slider
          label="Heavy attack combo (Galvanized Reflex ≈ 5×)"
          value={conditions.heavyComboMultiplier}
          min={1}
          max={12}
          step={0.5}
          display={`${conditions.heavyComboMultiplier}×`}
          onChange={(v) => setC({ heavyComboMultiplier: v })}
        />
        <Slider
          label="Warframe shields (Melee Retaliation)"
          value={conditions.shields ?? 0}
          min={0}
          max={3000}
          step={100}
          display={String(conditions.shields ?? 0)}
          onChange={(v) => setC({ shields: v })}
        />
      </Section>
    </aside>
  );
}
