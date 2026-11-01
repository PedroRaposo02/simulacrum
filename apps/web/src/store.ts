import { create } from "zustand";
import init, { Engine } from "./wasm/wf_wasm.js";
import type { Build, BuildResult, CalcError, GameData, RankRow, Target } from "./types";

export const emptyBuild = (weapon = ""): Build => ({
  weapon,
  mods: [],
  arcane: null,
  riven: [],
  buffs: [],
  conditions: { conditionalUptime: 1, headshotShare: 0 },
});

interface State {
  status: "loading" | "ready" | "error";
  error?: string;
  data?: GameData;
  engine?: Engine;
  tab: "browser" | "build";
  build: Build;
  target: Target;
  setTab: (t: State["tab"]) => void;
  setBuild: (b: Build) => void;
  setTarget: (t: Target) => void;
  openWeapon: (id: string) => void;
  load: () => Promise<void>;
}

const SHARE_PREFIX = "#b=";

function readShared(): Build | null {
  if (!location.hash.startsWith(SHARE_PREFIX)) return null;
  try {
    return { ...emptyBuild(), ...JSON.parse(decodeURIComponent(atob(location.hash.slice(SHARE_PREFIX.length)))) };
  } catch {
    return null;
  }
}

export function shareLink(b: Build): string {
  return `${location.origin}${location.pathname}${SHARE_PREFIX}${btoa(encodeURIComponent(JSON.stringify(b)))}`;
}

export const useStore = create<State>((set, get) => ({
  status: "loading",
  tab: "browser",
  build: emptyBuild(),
  target: { enemy: "sp-grineer", armorStrip: 0 },
  setTab: (tab) => set({ tab }),
  setBuild: (build) => set({ build }),
  setTarget: (target) => set({ target }),
  openWeapon: (id) => {
    const cur = get().build;
    set({ tab: "build", build: cur.weapon === id ? cur : emptyBuild(id) });
  },
  load: async () => {
    try {
      const [, text] = await Promise.all([init(), fetch(`${import.meta.env.BASE_URL}gamedata.json`).then((r) => r.text())]);
      const engine = new Engine(text);
      const data = JSON.parse(text) as GameData;
      const shared = readShared();
      set({ status: "ready", engine, data, ...(shared ? { build: shared, tab: "build" } : {}) });
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },
}));

export function compute(engine: Engine, build: Build, target: Target): { ok?: BuildResult; error?: CalcError } {
  return JSON.parse(engine.compute(JSON.stringify(build), JSON.stringify(target)));
}

export function rank(engine: Engine, target: Target): RankRow[] {
  return JSON.parse(engine.rank(JSON.stringify(target)));
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
