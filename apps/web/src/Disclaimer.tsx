/** What "best build" means here: deliberate choices that differ from raw maximum DPS. */
export default function BestBuildDisclaimer({ compact = false }: { compact?: boolean }) {
  const points = [
    "Fire rate past +150% over the weapon's own fire rate counts for nothing, so slots go to damage and status instead. Pure burst DPS can be higher.",
    "Explosive weapons (Torid, Tonkor, Bramma…) carry an explosion-radius mod, which adds no single-target damage; the exilus gets a fitting utility mod (beam range, projectile speed, recoil) unless a damage mod is better, and is dropped if the build can't fit 60 capacity even with forma.",
    "Heavy Caliber is avoided unless nothing else comes within 5%.",
    "DPS includes status damage (Bleed, Burn, Toxin, Gas, Electricity, Blast). Heat stacks are averaged over a 15 s fight; group numbers assume 5 enemies within 5 m.",
    "Situational bonuses (with overshields, channeled abilities, shield break, energy or armor thresholds) are off in best builds; enable them under Scenario › Situational triggers.",
    "Incarnon sustained DPS includes refilling the gauge in normal form, with half the hits on weak points.",
    "Arcanes assume steady play: Melee Exposure kept at 4 ability casts, on-kill arcanes at the uptime slider, status-stack arcanes (Primary Blight, Cascadia Flare…) at the stacks the weapon's own procs keep up.",
    "Sustained DPS is used, so reloads count: small magazines are penalised.",
    "Faction mods (Bane, Expel, Smite…) are excluded unless you allow them.",
    "Conditional effects (on-kill stacks, headshot-kill buffs, channeled abilities) are assumed to be fully up; lower the uptime in Scenario › Conditions to be stricter.",
    "Rivens are max rolls with at most one spliced stat; capacity and polarities are ignored unless you enable the realistic mode.",
  ];
  if (compact) {
    return (
      <p className="text-xs text-zinc-500">
        Most DPS builds are opinionated: comfortable fire rate, sustained DPS, no faction mods, full conditional uptime, max-roll riven. Use the optimizer&apos;s
        &quot;Burst DPS&quot; objective for raw maximum numbers.
      </p>
    );
  }
  return (
    <div className="card space-y-2 text-sm">
      <h3 className="font-semibold">About &quot;Most DPS&quot; builds</h3>
      <p className="text-zinc-500">They aim for what&apos;s strong and comfortable to use, not the highest number on paper:</p>
      <ul className="list-inside list-disc space-y-1 text-zinc-500">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="text-zinc-500">Switch the optimizer&apos;s objective to &quot;Burst DPS&quot; in the build editor to see the raw maximum.</p>
    </div>
  );
}
