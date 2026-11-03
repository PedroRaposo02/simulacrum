import type { GameData, Modifier, ModPool, RivenLayout, RivenPick, RivenRow, RivenStatDef, RivenState, RivenTable, RivenType, Weapon } from "./types";

export const emptyRiven = (): RivenState => ({ positives: [], negative: null });

/** Whether a riven stat can roll on this weapon: physical types need more than 25% of its main attack's
 * damage; elements, Punch Through and spliced stats are positive-only; Zoom, Recoil and Ammo Maximum
 * no longer roll on companion weapons. */
export function rivenStatAllowed(s: RivenStatDef, weapon: Weapon, negative: boolean): boolean {
  if (s.stat?.kind === "physical") {
    // The weapon's own stats decide: its main normal attack, not an Incarnon form.
    const mode = weapon.modes.find((m) => m.headline !== false && !m.incarnonForm) ?? weapon.modes[0];
    const comps = mode?.components ?? [];
    const total = comps.reduce((a, c) => a + Object.values(c.damage).reduce((x, y) => x + y, 0), 0);
    const of = (s.stat as { of?: string }).of ?? "";
    const ofT = comps.reduce((a, c) => a + (c.damage[of] ?? 0), 0);
    if (!(total > 0) || ofT / total <= 0.25) return false;
  }
  if (negative && (s.positiveOnly || s.spliced)) return false;
  return !(s.vintageOnCompanion && weapon.slot === "companion");
}

export function rivenType(pool: ModPool): RivenType {
  switch (pool) {
    case "shotgun":
      return "shotgun";
    case "secondary":
      return "pistol";
    case "archGun":
      return "archGun";
    case "melee":
      return "melee";
    default:
      return "rifle";
  }
}

export function layoutOf(table: RivenTable, r: RivenState): RivenLayout | undefined {
  const n = Math.max(2, r.positives.length);
  return table.layouts.find((l) => l.positives === n && l.negative === (r.negative != null));
}

/** [min, max] rolled value; negatives come back as negative numbers (min is the worst roll). */
export function statRange(table: RivenTable, key: string, ty: RivenType, layout: RivenLayout, negative: boolean): [number, number] | null {
  const def = table.stats.find((s) => s.key === key);
  const base = def?.base[ty];
  if (base == null) return null;
  const v = base * table.disposition * (negative ? -layout.negativeMult : layout.positiveMult);
  const a = v * table.rollMin;
  const b = v * table.rollMax;
  return negative ? [Math.min(a, b), Math.max(a, b)] : [a, b];
}

/** Value at a roll position: 0 = worst roll, 1 = best roll (for negatives, best = smallest penalty). */
export function rowValue(table: RivenTable, row: RivenRow, ty: RivenType, layout: RivenLayout, negative: boolean): number | null {
  const r = statRange(table, row.key, ty, layout, negative);
  if (!r) return null;
  return r[0] + (r[1] - r[0]) * row.roll;
}

export function rivenModifiers(data: GameData, r: RivenState, pool: ModPool): Modifier[] {
  const table = data.riven;
  if (!table) return [];
  const layout = layoutOf(table, r);
  if (!layout) return [];
  const ty = rivenType(pool);
  const rows: [RivenRow, boolean][] = [...r.positives.map((p) => [p, false] as [RivenRow, boolean]), ...(r.negative ? [[r.negative, true] as [RivenRow, boolean]] : [])];
  const out: Modifier[] = [];
  for (const [row, neg] of rows) {
    const def = table.stats.find((s) => s.key === row.key);
    const value = rowValue(table, row, ty, layout, neg);
    if (!def?.stat || value == null) continue;
    out.push({ source: `Riven ${def.label}`, stat: def.stat, value, ...(def.appliesTo ? { appliesTo: def.appliesTo } : {}) });
  }
  return out;
}

/** Convert optimizer picks (absolute values) back into roll positions. */
export function rivenFromPicks(table: RivenTable, picks: RivenPick[], negative: RivenPick | null | undefined, pool: ModPool): RivenState {
  const ty = rivenType(pool);
  const state: RivenState = {
    positives: picks.map((p) => ({ key: p.key, roll: 1 })),
    negative: negative ? { key: negative.key, roll: 1 } : null,
  };
  const layout = layoutOf(table, state);
  if (!layout) return state;
  const toRoll = (p: RivenPick, neg: boolean) => {
    const r = statRange(table, p.key, ty, layout, neg);
    if (!r) return 1;
    return Math.min(1, Math.max(0, (p.value - r[0]) / (r[1] - r[0] || 1)));
  };
  state.positives = picks.map((p) => ({ key: p.key, roll: toRoll(p, false) }));
  // The optimizer's negatives are harmless stats: show them at their smallest penalty (best roll).
  if (negative) state.negative = { key: negative.key, roll: 1 };
  return state;
}

/** Display a rolled value: percentages as %, flat stats with their unit. */
export function formatRivenValue(table: RivenTable, key: string, value: number): string {
  const def = table.stats.find((s) => s.key === key);
  const sign = value > 0 ? "+" : "";
  if (def?.unit) return `${sign}${value.toFixed(def.unit === "count" ? 1 : 2)}${def.unit === "count" ? "" : ` ${def.unit}`}`;
  return `${sign}${(value * 100).toFixed(1)}%`;
}
