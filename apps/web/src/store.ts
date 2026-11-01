import { create } from "zustand";
import init, { Engine } from "./wasm/wf_wasm.js";
import { emptyRiven, rivenFromPicks, rivenModifiers } from "./riven";
import type {
  BestBuilds,
  BestEntry,
  BuildResult,
  CalcError,
  Conditions,
  EditorBuild,
  EngineBuild,
  GameData,
  Modifier,
  OptimizeOptions,
  OptimizeResult,
  RankRow,
  SavedBuild,
  Target,
  Weapon,
} from "./types";

export const SLOT_COUNT = 8;

export const emptyBuild = (weapon = ""): EditorBuild => ({
  weapon,
  slots: Array(SLOT_COUNT + 1).fill(""),
  arcane: null,
  riven: emptyRiven(),
  evolutions: [],
});

/** The riven sits in the last normal slot. */
export const RIVEN_SLOT = SLOT_COUNT - 1;

/**
 * Put a riven into its slot. A mod already there moves to the first free normal slot; if every
 * slot is taken it's removed. Returns the updated build and the name of a removed mod, if any.
 */
export function placeRiven(b: EditorBuild): { build: EditorBuild; displaced: string | null } {
  if (!b.riven.positives.length || !b.slots[RIVEN_SLOT]) return { build: b, displaced: null };
  const slots = [...b.slots];
  const mod = slots[RIVEN_SLOT];
  slots[RIVEN_SLOT] = "";
  const free = slots.findIndex((s, i) => i < RIVEN_SLOT && !s);
  if (free >= 0) {
    slots[free] = mod;
    return { build: { ...b, slots }, displaced: null };
  }
  return { build: { ...b, slots }, displaced: mod };
}

export const defaultConditions = (): Conditions => ({
  conditionalUptime: 1,
  headshotShare: 0,
  statusTypes: 4,
  comboMultiplier: 12,
  heavyComboMultiplier: 5,
  headshotEffects: true,
});

export interface BuffState {
  on: boolean;
  /** Value at 100% strength, as a fraction; null = use the data default. */
  value: number | null;
  /** Helminth version (lower value) instead of the frame's own ability. */
  subsumed?: boolean;
}

/** The value a buff's first modifier has at 100% strength, given its state. */
export function buffBaseValue(b: { modifiers: Modifier[]; subsumedValue?: number }, st: BuffState | undefined): number {
  if (st?.value != null) return st.value;
  if (st?.subsumed && b.subsumedValue != null) return b.subsumedValue;
  return b.modifiers[0]?.value ?? 0;
}

export interface Scenario {
  target: Target;
  conditions: Conditions;
  /** Ability strength multiplier, 1 = 100%. */
  strength: number;
  buffs: Record<string, BuffState>;
}

export const defaultScenario = (): Scenario => ({
  target: { enemy: "sp-grineer", armorStrip: 0, viralStacks: null, corrosiveStacks: null, heatActive: false },
  conditions: defaultConditions(),
  strength: 1,
  buffs: {},
});

export type BrowserBuild = "unmodded" | "best" | "bestRiven";

interface State {
  status: "loading" | "ready" | "error";
  error?: string;
  data?: GameData;
  engine?: Engine;
  best?: BestBuilds;
  bestStale: boolean;
  tab: "browser" | "build";
  build: EditorBuild;
  scenario: Scenario;
  browserBuild: BrowserBuild;
  setTab: (t: State["tab"]) => void;
  setBuild: (b: EditorBuild) => void;
  setScenario: (s: Scenario) => void;
  setBrowserBuild: (b: BrowserBuild) => void;
  openWeapon: (id: string, best?: BestEntry) => void;
  load: () => Promise<void>;
}

const SHARE_PREFIX = "#b=";

function readShared(): EditorBuild | null {
  if (!location.hash.startsWith(SHARE_PREFIX)) return null;
  try {
    const b = JSON.parse(decodeURIComponent(atob(location.hash.slice(SHARE_PREFIX.length))));
    const base = emptyBuild(b.weapon ?? "");
    return { ...base, ...b, evolutions: b.evolutions ?? [], slots: [...(b.slots ?? []), ...base.slots].slice(0, SLOT_COUNT + 1) };
  } catch {
    return null;
  }
}

export function shareLink(b: EditorBuild): string {
  return `${location.origin}${location.pathname}${SHARE_PREFIX}${btoa(encodeURIComponent(JSON.stringify(b)))}`;
}

/** Place an ordered mod list into slots: when all normal slots are used, the last mod goes to the exilus slot. */
export function slotsFrom(data: GameData, mods: string[], hasRiven: boolean): string[] {
  const slots = Array(SLOT_COUNT + 1).fill("");
  const normal = SLOT_COUNT - (hasRiven ? 1 : 0);
  const ids = mods.map((n) => data.mods.find((m) => m.name === n || m.id === n)?.id ?? n);
  const last = data.mods.find((m) => m.id === ids[ids.length - 1]);
  if (ids.length > normal && last?.isExilus) {
    slots[SLOT_COUNT] = ids.pop()!;
  }
  ids.slice(0, SLOT_COUNT).forEach((id, i) => (slots[i] = id));
  return slots;
}

export function buildFromBest(data: GameData, weapon: Weapon, e: BestEntry): EditorBuild {
  const riven = e.riven?.length && data.riven ? rivenFromPicks(data.riven, e.riven, e.rivenNegative, weapon.modPool) : emptyRiven();
  return { weapon: weapon.id, slots: slotsFrom(data, e.mods, !!e.riven?.length), arcane: e.arcane, riven, evolutions: e.evolutions ?? [] };
}

export function buffModifiers(data: GameData, s: Scenario): Modifier[] {
  const out: Modifier[] = [];
  for (const b of data.buffs) {
    const st = s.buffs[b.id];
    if (!st?.on) continue;
    b.modifiers.forEach((m, i) => {
      const base = i === 0 ? buffBaseValue(b, st) : m.value;
      const who = st.subsumed && b.subsumedValue != null ? "subsumed" : b.source;
      out.push({ ...m, source: `${b.name} (${who})`, value: base * (b.scalesWithStrength ? s.strength : 1) });
    });
  }
  return out;
}

export function engineBuild(data: GameData, b: EditorBuild, s: Scenario): EngineBuild {
  const weapon = data.weapons.find((w) => w.id === b.weapon);
  return {
    weapon: b.weapon,
    mods: b.slots.filter(Boolean),
    arcane: b.arcane,
    riven: weapon ? rivenModifiers(data, b.riven, weapon.modPool) : [],
    buffs: buffModifiers(data, s),
    evolutions: (b.evolutions ?? []).filter(Boolean),
    conditions: s.conditions,
  };
}

/** Base build carrying only the scenario (buffs + conditions), for rank/optimize calls. */
export function scenarioBuild(data: GameData, s: Scenario): EngineBuild {
  return { weapon: "", mods: [], arcane: null, riven: [], buffs: buffModifiers(data, s), evolutions: [], conditions: s.conditions };
}

export const targetKey = (t: Target) => t.enemy ?? "raw";

export const useStore = create<State>((set, get) => ({
  status: "loading",
  bestStale: false,
  tab: "browser",
  build: emptyBuild(),
  scenario: defaultScenario(),
  browserBuild: "unmodded",
  setTab: (tab) => set({ tab }),
  setBuild: (build) => set({ build }),
  setScenario: (scenario) => set({ scenario }),
  setBrowserBuild: (browserBuild) => set({ browserBuild }),
  openWeapon: (id, best) => {
    const { data, build } = get();
    const weapon = data!.weapons.find((w) => w.id === id)!;
    const next = best ? buildFromBest(data!, weapon, best) : build.weapon === id ? build : emptyBuild(id);
    set({ tab: "build", build: next });
  },
  load: async () => {
    try {
      const base = import.meta.env.BASE_URL;
      const [, text, bestText] = await Promise.all([
        init(),
        fetch(`${base}gamedata.json`).then((r) => r.text()),
        fetch(`${base}best-builds.json`)
          .then((r) => (r.ok ? r.text() : null))
          .catch(() => null),
      ]);
      const engine = new Engine(text);
      const data = JSON.parse(text) as GameData;
      let best: BestBuilds | undefined;
      try {
        best = bestText ? (JSON.parse(bestText) as BestBuilds) : undefined;
      } catch {
        best = undefined;
      }
      const shared = readShared();
      set({
        status: "ready",
        engine,
        data,
        best,
        bestStale: !!best && best.dataVersion !== data.version,
        ...(shared ? { build: shared, tab: "build" } : {}),
      });
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },
}));

export function compute(engine: Engine, build: EngineBuild, target: Target): { ok?: BuildResult; error?: CalcError } {
  return JSON.parse(engine.compute(JSON.stringify(build), JSON.stringify(target)));
}

export function rank(engine: Engine, target: Target, base: EngineBuild, perWeapon: Record<string, unknown>): RankRow[] {
  return JSON.parse(engine.rank(JSON.stringify(target), JSON.stringify(base), JSON.stringify(perWeapon)));
}

// Optimizer runs in a worker so the page stays responsive.
let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (r: { ok?: OptimizeResult; error?: CalcError }) => void>();

export function optimizeInWorker(weapon: string, base: EngineBuild, target: Target, options: OptimizeOptions): Promise<{ ok?: OptimizeResult; error?: CalcError }> {
  if (!worker) {
    worker = new Worker(new URL("./optimizer.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; result: string }>) => {
      pending.get(e.data.id)?.(JSON.parse(e.data.result));
      pending.delete(e.data.id);
    };
  }
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ id, weapon, base: JSON.stringify(base), target: JSON.stringify(target), options: JSON.stringify(options) });
  });
}

export function fmt(v: number): string {
  if (!isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(3);
}

export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;

// Saved builds live in this browser only (localStorage); export/import moves them elsewhere.
const SAVED_KEY = "simulacrum.savedBuilds.v1";

export function loadSaved(): SavedBuild[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const list = raw ? (JSON.parse(raw) as SavedBuild[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function storeSaved(list: SavedBuild[]): boolean {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
