import { THEMES, type ThemeId } from "./themes";

const KEY = "simulacrum.theme";

export function savedTheme(): ThemeId {
  try {
    const t = localStorage.getItem(KEY);
    if (t && THEMES.some((x) => x.id === t)) return t as ThemeId;
  } catch {
    // storage unavailable: fall through to the default
  }
  return "midnight";
}

export function applyTheme(id: ThemeId) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  document.documentElement.dataset.theme = t.id;
  document.documentElement.dataset.mode = t.mode;
  try {
    localStorage.setItem(KEY, t.id);
  } catch {
    // not persisted; the theme still applies for this visit
  }
}
