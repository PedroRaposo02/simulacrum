import { useState, type ReactNode } from "react";
import { Slider, Toggle } from "./Common";
import { defaultScenario, useStore } from "./store";
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
  const { data, scenario, setScenario } = useStore();
  const { target, conditions } = scenario;
  const setT = (t: Partial<Target>) => setScenario({ ...scenario, target: { ...target, ...t } });
  const setC = (c: Partial<Conditions>) => setScenario({ ...scenario, conditions: { ...conditions, ...c } });

  return (
    <aside className="card space-y-3 self-start">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Scenario</h2>
        <button className="text-xs text-indigo-600 hover:underline" onClick={() => setScenario(defaultScenario())}>
          Reset
        </button>
      </div>

      <Section title="Enemy">
        <select className="field" value={target.enemy ?? ""} onChange={(e) => setT({ enemy: e.target.value || null })}>
          <option value="">Raw (no enemy)</option>
          {data!.enemies.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <Slider label="External armor strip" value={target.armorStrip} onChange={(v) => setT({ armorStrip: v })} disabled={!target.enemy} />
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
          const base = st.value ?? b.modifiers[0]?.value ?? 0;
          const effective = base * (b.scalesWithStrength ? scenario.strength : 1);
          const setB = (next: Partial<typeof st>) => setScenario({ ...scenario, buffs: { ...scenario.buffs, [b.id]: { ...st, ...next } } });
          return (
            <div key={b.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Toggle
                  label={
                    <span>
                      {b.name} <span className="text-xs text-zinc-500">{b.source}</span>
                    </span>
                  }
                  title={b.note}
                  checked={st.on}
                  onChange={(on) => setB({ on })}
                />
              </div>
              <input
                type="number"
                className="field w-20 py-1 text-right"
                title={`Value at 100% strength (${b.scalesWithStrength ? `×${scenario.strength.toFixed(2)} strength → ${Math.round(effective * 100)}%` : "doesn't scale with strength"})`}
                value={Math.round(base * 1000) / 10}
                onChange={(e) => setB({ value: Number(e.target.value) / 100 })}
              />
              <span className="text-xs text-zinc-500">%</span>
            </div>
          );
        })}
        <p className="text-xs text-zinc-500">Values are at 100% strength; hover for the scaled value. Defaults need in-game checks.</p>
      </Section>

      <Section title="Conditions" defaultOpen={false}>
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
          label="Melee combo multiplier"
          value={conditions.comboMultiplier}
          min={1}
          max={12}
          step={0.5}
          display={`${conditions.comboMultiplier}×`}
          onChange={(v) => setC({ comboMultiplier: v })}
        />
      </Section>
    </aside>
  );
}
