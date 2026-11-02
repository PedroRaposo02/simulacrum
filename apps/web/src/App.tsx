import { useEffect, useState } from "react";
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
import Compare from "./Compare";
import { installUpdate, IS_DESKTOP, isNewer, latestRelease, openExternal, RELEASES_URL, type Release } from "./desktop";
import { readSetting, writeSetting } from "./persist";

// The browser's install prompt (Chrome, Edge, Android), kept until the user clicks Install.
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  if (!prompt || IS_DESKTOP) return null;
  return (
    <button
      className="rounded-md border border-indigo-400 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-600 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
      title="Install as an app: its own window, works offline, updates with the site"
      onClick={async () => {
        await prompt.prompt();
        await prompt.userChoice;
        setPrompt(null);
      }}
    >
      Install app
    </button>
  );
}

/** Desktop app: offers a newer release from GitHub (checked once per launch). */
function UpdateBanner() {
  const [release, setRelease] = useState<Release | null>(null);
  const [state, setState] = useState<"idle" | "installing" | "error">("idle");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!IS_DESKTOP) return;
    latestRelease().then((r) => {
      if (r && isNewer(r.version, APP_VERSION) && readSetting<string>("updateSkipped", "") !== r.version) setRelease(r);
    });
  }, []);
  if (!release) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm dark:border-indigo-800 dark:bg-indigo-950/40">
      <span>
        <b>Simulacrum v{release.version}</b> is available (you have v{APP_VERSION}).
      </span>
      {state === "installing" ? (
        <span className="text-zinc-500">Downloading and installing; the app restarts when it&apos;s done…</span>
      ) : (
        <>
          <button
            className="rounded-md bg-indigo-600 px-3 py-1 font-medium text-white hover:bg-indigo-500"
            onClick={async () => {
              setState("installing");
              try {
                await installUpdate(release.manifest);
              } catch (e) {
                setError(String(e));
                setState("error");
              }
            }}
          >
            Update and restart
          </button>
          <button className="text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => openExternal(release.notesUrl)}>
            What&apos;s new
          </button>
          <button
            className="ml-auto text-zinc-500 hover:underline"
            onClick={() => {
              writeSetting("updateSkipped", release.version);
              setRelease(null);
            }}
          >
            Skip this version
          </button>
          <button className="text-zinc-500 hover:underline" onClick={() => setRelease(null)}>
            Later
          </button>
        </>
      )}
      {state === "error" && <span className="basis-full text-red-600">Update failed: {error}. You can download it from the releases page.</span>}
    </div>
  );
}

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
      <UpdateBanner />
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
        {tabBtn("compare", "Compare")}
        {tabBtn("settings", "Settings")}
        <span className="ml-auto hidden text-xs text-zinc-500 md:inline">
          data {data?.version} · {data?.weapons.length} weapons · {data?.mods.length} mods
        </span>
        <InstallButton />
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
      ) : tab === "compare" ? (
        <div className="grid flex-1 gap-4 lg:grid-cols-[300px_1fr]">
          <ScenarioPanel />
          <main className="min-w-0">
            <Compare />
          </main>
        </div>
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
        {!IS_DESKTOP && (
          <a className="text-indigo-600 hover:underline dark:text-indigo-400" href={RELEASES_URL} target="_blank" rel="noreferrer">
            Desktop app
          </a>
        )}
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
          Data: {Object.values(data?.sources ?? {}).join(" · ")}. Free, non-commercial fan project, not affiliated with or endorsed by Digital Extremes. Warframe is a trademark of Digital Extremes Ltd.
        </span>
      </footer>
    </div>
  );
}
