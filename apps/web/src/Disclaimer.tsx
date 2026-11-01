/** What "best build" means here: deliberate choices that differ from raw maximum DPS. */
export default function BestBuildDisclaimer({ compact = false }: { compact?: boolean }) {
  const points = [
    "Fire rate above a comfortable rate (10 shots/s automatic, 6 semi-auto, or 1.25x the weapon's own) counts for nothing, so slots go to damage and status instead. Pure burst DPS can be higher.",
    "Sustained DPS is used, so reloads count: small magazines are penalised.",
    "Faction mods (Bane, Expel, Smite…) are excluded unless you allow them.",
    "Conditional effects (on-kill stacks, headshot-kill buffs, channeled abilities) are assumed to be fully up; lower the uptime in Scenario › Conditions to be stricter.",
    "Rivens are max rolls with at most one spliced stat; capacity and polarities are ignored unless you enable the realistic mode.",
  ];
  if (compact) {
    return (
      <p className="text-xs text-zinc-500">
        Best builds are opinionated: comfortable fire rate, sustained DPS, no faction mods, full conditional uptime, max-roll riven. Use the optimizer&apos;s
        &quot;Burst DPS&quot; objective for raw maximum numbers.
      </p>
    );
  }
  return (
    <div className="card space-y-2 text-sm">
      <h3 className="font-semibold">About &quot;best builds&quot;</h3>
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
