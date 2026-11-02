// The desktop app (Tauri) runs this same site; these helpers only do something there.
import { SITE } from "./site";

export const IS_DESKTOP = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const REPO = SITE.repoUrl.replace("https://github.com/", "");
export const RELEASES_URL = `${SITE.repoUrl}/releases`;

export interface Release {
  version: string;
  notesUrl: string;
  /** The release's updater manifest (latest.json). */
  manifest: string;
}

/** Newest published release with a desktop update, or null (offline, rate limited, none yet). */
export async function latestRelease(): Promise<Release | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const list = (await r.json()) as { tag_name: string; draft: boolean; html_url: string; assets: { name: string; browser_download_url: string }[] }[];
    const rel = list.find((x) => !x.draft && x.assets.some((a) => a.name === "latest.json"));
    if (!rel) return null;
    return {
      version: rel.tag_name.replace(/^v/, ""),
      notesUrl: rel.html_url,
      manifest: rel.assets.find((a) => a.name === "latest.json")!.browser_download_url,
    };
  } catch {
    return null;
  }
}

/** Semantic version order, prereleases before their release (0.7.0-beta.2 < 0.7.0). */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [core, pre] = v.split("-", 2);
    return { core: core.split(".").map(Number), pre: pre ? pre.split(".") : [] };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.core[i] ?? 0) !== (y.core[i] ?? 0)) return (x.core[i] ?? 0) > (y.core[i] ?? 0);
  if (!x.pre.length || !y.pre.length) return !x.pre.length && y.pre.length > 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return false;
    if (q === undefined) return true;
    if (p === q) continue;
    const [pn, qn] = [Number(p), Number(q)];
    if (!isNaN(pn) && !isNaN(qn)) return pn > qn;
    return p > q;
  }
  return false;
}

export async function installUpdate(manifest: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("install_update", { manifest });
}

export async function openExternal(url: string): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

/** In the desktop app, links to other sites open in the default browser instead of the app window. */
export function routeExternalLinks(): void {
  if (!IS_DESKTOP) return;
  document.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.("a");
    if (!a?.href || a.hasAttribute("download") || !/^https?:/.test(a.href) || new URL(a.href).origin === location.origin) return;
    e.preventDefault();
    openExternal(a.href);
  });
}
