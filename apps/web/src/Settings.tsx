import { useRef, useState, type ReactNode } from "react";
import { exportSettings, importSettings, KEYS, readSetting, removeSettings, writeSetting } from "./persist";
import { AUTO_WORKERS, cancelSearch, defaultScenario, MAX_WORKERS, mergeScenario, useStore, type Scenario } from "./store";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const btn = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
const danger = "rounded-md border border-red-400 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40";

/** Settings: default scenario, resets, and a backup file of everything stored in this browser. */
export default function Settings() {
  const { data, scenario, setScenario } = useStore();
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cores = navigator.hardwareConcurrency || 2;
  const [workers, setWorkers] = useState<number | "auto">(() => readSetting<number | "auto">("opt.workers", "auto"));
  const [savedDefault, setSavedDefault] = useState<Partial<Scenario> | null>(() => readSetting<Partial<Scenario> | null>("defaultScenario", null));

  const describe = (s: Scenario) => {
    const enemy = s.target.enemy ? data!.enemies.find((e) => e.id === s.target.enemy)?.name ?? s.target.enemy : "Raw (unarmored target)";
    const buffs = data!.buffs.filter((b) => s.buffs[b.id]?.on).map((b) => b.name);
    const triggers = s.conditions.triggers ?? [];
    return [
      enemy,
      buffs.length ? `buffs: ${buffs.join(", ")}` : "no buffs",
      s.target.corrosiveProjection ? `${s.target.corrosiveProjection}x Corrosive Projection` : null,
      triggers.length ? `${triggers.length} situational trigger(s) on` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };

  // Resets that touch component state reload the page so every control picks up its default.
  const resetAndReload = (keys: string[], what: string) => {
    if (!confirm(`Reset ${what}?`)) return;
    removeSettings(keys);
    location.reload();
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(exportSettings(), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `simulacrum-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const upload = async (file: File) => {
    try {
      const n = importSettings(JSON.parse(await file.text()));
      setNotice(`Restored ${n} settings. Reloading…`);
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      setNotice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p className="text-sm text-zinc-500">
        Everything here is stored in this browser only. Your scenario, last build, optimizer options, weapon list filters and view choices are remembered
        automatically; use the backup file to move them (with saved builds and favorites) to another browser or PC.
      </p>
      {notice && <p className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">{notice}</p>}

      <Block title="Default scenario">
        <p className="text-sm text-zinc-500">What Scenario › Reset goes back to. Set up the sidebar the way you usually play, then save it here.</p>
        <dl className="space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-zinc-500">Current</dt>
            <dd>{describe(scenario)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-zinc-500">Default</dt>
            <dd>{savedDefault ? describe(mergeScenario(savedDefault)) : `built-in (${describe(defaultScenario())})`}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <button
            className={btn}
            onClick={() => {
              writeSetting("defaultScenario", scenario);
              setSavedDefault(scenario);
              setNotice("Current scenario saved as your default.");
            }}
          >
            Use current scenario as default
          </button>
          <button
            className={btn}
            onClick={() => {
              removeSettings(KEYS.defaultScenario);
              setSavedDefault(null);
              setNotice("Default scenario is the built-in one again.");
            }}
            disabled={!savedDefault}
          >
            Restore built-in default
          </button>
          <button
            className={btn}
            onClick={() => {
              setScenario(mergeScenario(savedDefault) ?? defaultScenario());
              setNotice("Scenario reset to the default.");
            }}
          >
            Reset scenario now
          </button>
        </div>
      </Block>

      <Block title="Optimizer">
        <label className="block text-sm">
          Parallel searches
          <select
            className="field mt-1 w-auto"
            value={String(workers)}
            onChange={(e) => {
              const v = e.target.value === "auto" ? "auto" : Number(e.target.value);
              writeSetting("opt.workers", v);
              setWorkers(v);
              // Workers start again with the new count on the next search.
              cancelSearch();
            }}
          >
            <option value="auto">Auto ({Math.max(1, Math.min(AUTO_WORKERS, cores - 1))})</option>
            {Array.from({ length: MAX_WORKERS }, (_, i) => i + 1)
              .filter((n) => n <= Math.max(1, cores - 1))
              .map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
          </select>
        </label>
        <p className="text-[11px] text-zinc-500">
          A search split across this many background threads (attack modes, then riven searches), with the same result as one. Each one holds its own copy
          of the calculator and game data in memory, and in a browser they slow each other down, so more isn't always faster. This device has {cores}{" "}
          logical cores.
        </p>
      </Block>

      <Block title="Reset">
        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={() => resetAndReload(KEYS.optimizer, "optimizer options (objective, comfort, capacity, toggles)")}>
            Optimizer options
          </button>
          <button className={btn} onClick={() => resetAndReload(KEYS.browser, "weapon list filters and sorting")}>
            Weapon list filters
          </button>
          <button className={btn} onClick={() => resetAndReload(KEYS.view, "view preferences (theme, card view, stats toggles)")}>
            View preferences
          </button>
          <button className={btn} onClick={() => resetAndReload([...KEYS.session, ...KEYS.scenario], "the open build and scenario")}>
            Open build and scenario
          </button>
        </div>
        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <button
            className={danger}
            onClick={() =>
              resetAndReload(
                Object.values(KEYS).flat(),
                "EVERYTHING, including saved builds and favorites (export a backup first if you want to keep them)",
              )
            }
          >
            Reset everything
          </button>
        </div>
      </Block>

      <Block title="Backup">
        <p className="text-sm text-zinc-500">One file with every setting, your saved builds and favorites. Importing overwrites the matching entries here.</p>
        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={download}>
            Export settings file
          </button>
          <button className={btn} onClick={() => fileRef.current?.click()}>
            Import settings file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </div>
      </Block>
    </div>
  );
}
