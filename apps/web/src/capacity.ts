// Mod capacity and forma planning for the card view: which slots get which polarity, how many
// forma that takes, and the drain each slot ends up with.
// Kept local (not from the store) so this module has no runtime dependencies.
const SLOT_COUNT = 8;
const RIVEN_SLOT = SLOT_COUNT - 1;
import type { EditorBuild, GameData, Mod, Weapon } from "./types.ts";

/** Drain of a max-rank riven in a slot without matching polarity. */
const RIVEN_DRAIN = 18;

export interface SlotPlan {
  /** Slot index: 0-7 normal, 8 exilus. */
  slot: number;
  modId: string | null;
  riven: boolean;
  baseDrain: number;
  /** Polarity the slot ends up with (innate or forma'd); null = unpolarized. */
  polarity: string | null;
  /** True when the plan puts a forma in this slot. */
  forma: boolean;
  drain: number;
}

export interface CapacityPlan {
  slots: SlotPlan[];
  capacity: number;
  used: number;
  forma: number;
  fits: boolean;
}

export const modDrainAtMax = (m: Mod) => Math.max(0, m.baseDrain + m.maxRank);

function drainIn(base: number, modPolarity: string | null, slotPolarity: string | null): number {
  if (!slotPolarity) return base;
  if (!modPolarity || slotPolarity === modPolarity || modPolarity === "any") return Math.ceil(base / 2);
  return Math.round(base * 1.25);
}

/**
 * Plan polarities for a build: innate weapon polarities go to the matching mods with the most
 * drain, then forma go where they save the most until the build fits (or nothing helps).
 */
export function planCapacity(data: GameData, weapon: Weapon, build: EditorBuild, capacity: number): CapacityPlan {
  const hasRiven = build.riven.positives.length > 0;
  const mod = (id: string) => data.mods.find((m) => m.id === id);
  const slots: SlotPlan[] = [];
  for (let i = 0; i <= SLOT_COUNT; i++) {
    const riven = hasRiven && i === RIVEN_SLOT;
    const m = !riven && build.slots[i] ? mod(build.slots[i]) : undefined;
    slots.push({
      slot: i,
      modId: m?.id ?? null,
      riven,
      baseDrain: riven ? RIVEN_DRAIN : m ? modDrainAtMax(m) : 0,
      polarity: null,
      forma: false,
      drain: 0,
    });
  }
  const modPolarity = (s: SlotPlan): string | null => (s.riven ? "any" : s.modId ? mod(s.modId)?.polarity ?? null : null);

  // Innate normal-slot polarities: matching mods first (most drain), then empty slots, then the
  // cheapest mod (a mismatch costs +25%; a forma there can fix it later).
  const normal = slots.slice(0, SLOT_COUNT);
  for (const pol of weapon.polarities ?? []) {
    const free = normal.filter((s) => s.polarity === null);
    const match = free.filter((s) => s.baseDrain > 0 && (modPolarity(s) === pol || modPolarity(s) === "any")).sort((a, b) => b.baseDrain - a.baseDrain)[0];
    const target = match ?? free.find((s) => s.baseDrain === 0) ?? free.sort((a, b) => a.baseDrain - b.baseDrain)[0];
    if (target) target.polarity = pol;
  }
  slots[SLOT_COUNT].polarity = weapon.exilusPolarity ?? null;

  const recompute = () => {
    for (const s of slots) s.drain = s.baseDrain ? drainIn(s.baseDrain, modPolarity(s), s.polarity) : 0;
    return slots.reduce((a, s) => a + s.drain, 0);
  };
  let used = recompute();
  let forma = 0;
  while (used > capacity) {
    let best: { s: SlotPlan; saving: number } | null = null;
    for (const s of slots) {
      if (!s.baseDrain) continue;
      const pol = modPolarity(s);
      if (s.polarity && (s.polarity === pol || pol === "any")) continue;
      const saving = s.drain - Math.ceil(s.baseDrain / 2);
      if (saving > 0 && (!best || saving > best.saving)) best = { s, saving };
    }
    if (!best) break;
    best.s.polarity = best.s.riven ? "any" : modPolarity(best.s);
    best.s.forma = true;
    forma++;
    used = recompute();
  }
  return { slots, capacity, used, forma, fits: used <= capacity };
}
