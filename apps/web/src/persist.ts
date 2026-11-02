// Settings that survive a reload, in this browser's localStorage. Every key starts with PREFIX so
// the Settings page can export, import and reset them as a set.
import { useState } from "react";

export const PREFIX = "simulacrum.";

export function readSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw) as T;
    // Objects: keep defaults for fields added since the value was saved.
    if (fallback && typeof fallback === "object" && !Array.isArray(fallback) && v && typeof v === "object" && !Array.isArray(v)) {
      return { ...fallback, ...v };
    }
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeSetting(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the setting just isn't remembered
  }
}

export function removeSettings(keys: string[]): void {
  try {
    for (const k of keys) localStorage.removeItem(PREFIX + k);
  } catch {
    // ignore
  }
}

/** useState that remembers its value under `key`. */
export function usePersistent<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readSetting(key, initial));
  const set = (v: T) => {
    setValue(v);
    writeSetting(key, v);
  };
  return [value, set];
}

/** Every stored key (without the prefix). */
export function allKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
  } catch {
    // ignore
  }
  return out;
}

export interface SettingsFile {
  app: "warframe-simulacrum";
  version: 1;
  exportedAt: string;
  entries: Record<string, string>;
}

export function exportSettings(): SettingsFile {
  const entries: Record<string, string> = {};
  for (const k of allKeys()) {
    const v = localStorage.getItem(PREFIX + k);
    if (v != null) entries[k] = v;
  }
  return { app: "warframe-simulacrum", version: 1, exportedAt: new Date().toISOString(), entries };
}

/** Writes an exported file's entries back; returns how many were restored. */
export function importSettings(file: unknown): number {
  const f = file as Partial<SettingsFile>;
  if (f?.app !== "warframe-simulacrum" || !f.entries || typeof f.entries !== "object") throw new Error("Not a Warframe Simulacrum settings file");
  let n = 0;
  for (const [k, v] of Object.entries(f.entries)) {
    if (typeof v !== "string") continue;
    localStorage.setItem(PREFIX + k, v);
    n++;
  }
  return n;
}

// Keys by group, for the Settings page resets.
export const KEYS = {
  scenario: ["scenario"],
  defaultScenario: ["defaultScenario"],
  session: ["build", "tab", "browserBuild"],
  optimizer: [
    "opt.objective", "opt.realistic", "opt.capacity", "opt.allowFaction", "opt.tenacious", "opt.spliced", "opt.explosionMod", "opt.comfort",
  ],
  browser: ["browser.slot", "browser.favOnly", "browser.sort", "pageSize"],
  view: ["theme", "modView", "liveStats", "shareVsEnemy", "cards.catalyst", "cards.stance"],
  builds: ["savedBuilds.v1", "favorites.v1"],
};
