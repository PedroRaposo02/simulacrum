import { useEffect } from "react";
import { useStore } from "./store";
import WeaponBrowser from "./WeaponBrowser";
import BuildEditor from "./BuildEditor";
import ScenarioPanel from "./Scenario";

export default function App() {
  const { status, error, tab, setTab, data, load } = useStore();
  useEffect(() => {
    load();
  }, [load]);

  if (status === "loading") return <p className="p-8 text-zinc-500">Loading engine and game data…</p>;
  if (status === "error") return <p className="p-8 text-red-600">Failed to load: {error}</p>;

  const tabBtn = (t: typeof tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        tab === t ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Simulacrum</h1>
        <span className="mr-4 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
          BETA v{__APP_VERSION__}
        </span>
        {tabBtn("browser", "Weapon browser")}
        {tabBtn("build", "Build editor")}
        <span className="ml-auto text-xs text-zinc-500">
          data {data?.version} · {data?.weapons.length} weapons · {data?.mods.length} mods
        </span>
      </header>
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <ScenarioPanel />
        <main className="min-w-0">{tab === "browser" ? <WeaponBrowser /> : <BuildEditor />}</main>
      </div>
      <footer className="mt-8 text-xs text-zinc-500">
        Weapon and mod data: {Object.values(data?.sources ?? {}).join(" · ")}. Not affiliated with Digital Extremes.
      </footer>
    </div>
  );
}
