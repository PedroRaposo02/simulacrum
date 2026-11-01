import { useMemo } from "react";
import { compute, engineBuild, fmt, useStore } from "./store";
import type { EditorBuild, ModeResult, Weapon } from "./types";

const TARGET_COUNTS = [1, 2, 3, 5];

/** Damage dealt across n enemies when each extra enemy keeps `ft` of the previous one's damage. */
const multiTarget = (ft: number, n: number) => Array.from({ length: n }, (_, k) => ft ** k).reduce((a, b) => a + b, 0);

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" }) {
  const toneCls = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "";
  return (
    <div className="rounded-md bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">
      <div className="text-[11px] uppercase text-zinc-500">{label}</div>
      <div className={`num text-lg font-semibold ${toneCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

/** Melee at a glance: best light combo at 1x and 12x, heavy at 1x and the heavy combo, Tennokai, comfort. */
export default function MeleeSummary({ weapon, build, comfortSpeed }: { weapon: Weapon; build: EditorBuild; comfortSpeed: number }) {
  const { data, engine, scenario } = useStore();
  const melee = weapon.melee!;

  const at = (combo: number, heavyCombo: number) => {
    const s = { ...scenario, conditions: { ...scenario.conditions, comboMultiplier: combo, heavyComboMultiplier: heavyCombo } };
    return compute(engine!, engineBuild(data!, build, s), s.target).ok;
  };

  const view = useMemo(() => {
    const low = at(1, 1);
    const high = at(scenario.conditions.comboMultiplier, scenario.conditions.heavyComboMultiplier);
    if (!low || !high) return null;
    const role = (r: ModeResult) => weapon.modes[r.modeIndex]?.meleeRole;
    const lights = high.modes.filter((m) => role(m) === "light" && weapon.modes[m.modeIndex]?.headline !== false);
    const bestLight = lights.reduce<ModeResult | null>((b, m) => (!b || m.burstDps > b.burstDps ? m : b), null);
    const lightLow = bestLight ? low.modes.find((m) => m.modeIndex === bestLight.modeIndex) : undefined;
    const heavyHigh = high.modes.find((m) => role(m) === "heavy");
    const heavyLow = low.modes.find((m) => role(m) === "heavy");
    const tenno = high.modes.find((m) => role(m) === "tennokai");
    return { bestLight, lightLow, heavyHigh, heavyLow, tenno };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, data, build, scenario, weapon]);

  if (!view) return null;
  const { bestLight, lightLow, heavyHigh, heavyLow, tenno } = view;
  const combo = scenario.conditions.comboMultiplier;
  const heavyCombo = scenario.conditions.heavyComboMultiplier;
  const speed = bestLight?.attackSpeed ?? melee.attackSpeed;
  const range = bestLight?.rangeM ?? melee.rangeM;
  const hasTennokaiMod = build.slots.some((id) => data!.mods.find((m) => m.id === id)?.enablesTennokai);

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-semibold">Melee summary</h3>
        <span className="text-xs text-zinc-500">
          {melee.class} · {melee.stances.length} stance{melee.stances.length === 1 ? "" : "s"} · follow-through {Math.round(melee.followThrough * 100)}%
        </span>
      </div>

      {bestLight && (
        <>
          <div className="text-xs text-zinc-500">
            Light attacks — best combo: <span className="font-medium text-zinc-700 dark:text-zinc-300">{bestLight.mode}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="DPS, no combo (1×)" value={fmt(lightLow?.burstDps ?? 0)} />
            <Stat label={`DPS at ${combo}× combo`} value={fmt(bestLight.burstDps)} sub="combo mods (Blood Rush…) active" />
            <Stat
              label="Attack speed"
              value={speed.toFixed(2)}
              sub={`comfort target ≥ ${comfortSpeed.toFixed(2)}`}
              tone={speed >= comfortSpeed ? "good" : "warn"}
            />
            <Stat label="Range" value={`${range.toFixed(2)} m`} sub={`base ${melee.rangeM} m`} />
          </div>
        </>
      )}

      <div className="text-xs text-zinc-500">Heavy attack and Tennokai — damage per hit</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Heavy, no combo (1×)" value={fmt(heavyLow?.perShot ?? 0)} sub={`${melee.windUpS}s base wind-up`} />
        <Stat label={`Heavy at ${heavyCombo}× combo`} value={fmt(heavyHigh?.perShot ?? 0)} sub={heavyHigh ? `${fmt(heavyHigh.fireRate)} heavies/s (wind-up only)` : undefined} />
        <Stat
          label={`Tennokai at ${combo}× combo`}
          value={fmt(tenno?.perShot ?? 0)}
          sub={hasTennokaiMod ? "combo not consumed" : "needs a Tennokai mod"}
          tone={hasTennokaiMod ? undefined : "warn"}
        />
        <Stat label="Wiki heavy damage" value={fmt(melee.heavyDamage)} sub="unmodded, before combo" />
      </div>

      {bestLight && (
        <div>
          <div className="mb-1 text-xs text-zinc-500">
            Multi-target (best combo): each extra enemy in a swing takes {Math.round(melee.followThrough * 100)}% of the previous one's damage. Range decides how
            many you reach.
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {TARGET_COUNTS.map((n) => (
              <div key={n} className="rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700">
                <span className="text-zinc-500">{n} target{n > 1 ? "s" : ""}: </span>
                <span className="num font-medium">{fmt(bestLight.burstDps * multiTarget(melee.followThrough, n))}</span>
                <span className="text-xs text-zinc-500"> (×{multiTarget(melee.followThrough, n).toFixed(2)})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
