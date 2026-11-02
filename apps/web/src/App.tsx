import { useEffect } from "react";
import { useStore } from "./store";
import WeaponBrowser from "./WeaponBrowser";
import BuildEditor from "./BuildEditor";
import ScenarioPanel from "./Scenario";
import Home from "./Home";
import Logo from "./Logo";
import { APP_VERSION } from "./version";
import ThemePicker from "./ThemePicker";
import { SITE } from "./site";
import Settings from "./Settings";

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
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 py-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <button onClick={() => setTab("home")} className="flex items-center gap-2" title={SITE.tagline}>
          <Logo />
          <h1 className="text-lg font-semibold">{SITE.title}</h1>
        </button>
        <span className="mr-4 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
          BETA v{APP_VERSION}
        </span>
        {tabBtn("browser", "Weapons")}
        {tabBtn("build", "Build editor")}
        {tabBtn("settings", "Settings")}
        <span className="ml-auto hidden text-xs text-zinc-500 md:inline">
          data {data?.version} · {data?.weapons.length} weapons · {data?.mods.length} mods
        </span>
        <ThemePicker />
      </header>
      {tab === "home" ? (
        <main className="min-w-0 flex-1">
          <Home />
        </main>
      ) : tab === "settings" ? (
        <main className="min-w-0 flex-1">
          <Settings />
        </main>
      ) : (
        <div className="grid flex-1 gap-4 lg:grid-cols-[300px_1fr]">
          <ScenarioPanel />
          <main className="min-w-0">{tab === "browser" ? <WeaponBrowser /> : <BuildEditor />}</main>
        </div>
      )}
      <footer className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800">
        <span>
          Made by{" "}
          <a className="text-indigo-600 hover:underline dark:text-indigo-400" href={SITE.authorUrl} target="_blank" rel="noreferrer">
            {SITE.author}
          </a>
        </span>
        <a className="text-indigo-600 hover:underline dark:text-indigo-400" href={SITE.repoUrl} target="_blank" rel="noreferrer">
          Source code
        </a>
        {SITE.donateUrl && (
          <a
            className="rounded-md bg-amber-500 px-3 py-1 font-semibold text-black hover:bg-amber-400"
            href={SITE.donateUrl}
            target="_blank"
            rel="noreferrer"
          >
            ♥ Donate
          </a>
        )}
        <span className="basis-full">
          Data: {Object.values(data?.sources ?? {}).join(" · ")}. Warframe is a trademark of Digital Extremes; this project isn&apos;t affiliated with them.
        </span>
      </footer>
    </div>
  );
}
