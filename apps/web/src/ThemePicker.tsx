import { useState } from "react";
import { THEMES, type ThemeId } from "./themes";
import { applyTheme, savedTheme } from "./theme";

export default function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(savedTheme);
  const [open, setOpen] = useState(false);
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const pick = (id: ThemeId) => {
    applyTheme(id);
    setTheme(id);
    setOpen(false);
  };
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Swatch colors={current.swatch} />
        {current.label}
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-30 mt-1 w-48 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {(["dark", "light"] as const).map((mode) => (
            <li key={mode}>
              <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{mode === "dark" ? "Dark" : "Light"}</div>
              {THEMES.filter((t) => t.mode === mode).map((t) => (
                <button
                  key={t.id}
                  role="option"
                  aria-selected={t.id === theme}
                  onClick={() => pick(t.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    t.id === theme ? "font-semibold text-indigo-600 dark:text-indigo-400" : ""
                  }`}
                >
                  <Swatch colors={t.swatch} />
                  {t.label}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Swatch({ colors }: { colors: readonly string[] }) {
  return (
    <span className="inline-flex overflow-hidden rounded-sm border border-black/20">
      {colors.map((c) => (
        <span key={c} className="h-3 w-3" style={{ background: c }} />
      ))}
    </span>
  );
}
