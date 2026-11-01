import { useRef, useState } from "react";
import { downloadJson, loadSaved, storeSaved, useStore } from "./store";
import type { SavedBuild } from "./types";
import { Star, useFavorites } from "./favorites";

/** Named builds kept in this browser, with JSON export/import. */
export default function SavedBuilds() {
  const { data, build, setBuild } = useStore();
  const [list, setList] = useState<SavedBuild[]>(loadSaved);
  const favs = useFavorites();
  // Favorite builds first.
  const ordered = [...list].sort((a, b) => Number(favs.builds.includes(b.name)) - Number(favs.builds.includes(a.name)));
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const weaponName = (id: string) => data!.weapons.find((w) => w.id === id)?.name ?? id;

  const update = (next: SavedBuild[]) => {
    setList(next);
    if (!storeSaved(next)) setMsg("Couldn't save: browser storage is unavailable here. Use Export instead.");
  };

  const save = () => {
    if (!build.weapon) return;
    const n = name.trim() || `${weaponName(build.weapon)} ${new Date().toLocaleString()}`;
    update([{ name: n, savedAt: Date.now(), build }, ...list.filter((b) => b.name !== n)]);
    setName("");
    setMsg(`Saved "${n}".`);
  };

  const importFile = async (f: File) => {
    try {
      const parsed = JSON.parse(await f.text());
      const incoming: SavedBuild[] = (Array.isArray(parsed) ? parsed : [parsed]).filter((b) => b?.build?.weapon && b?.name);
      const names = new Set(incoming.map((b) => b.name));
      update([...incoming, ...list.filter((b) => !names.has(b.name))]);
      setMsg(`Imported ${incoming.length} build${incoming.length === 1 ? "" : "s"}.`);
    } catch {
      setMsg("That file isn't a saved-builds JSON.");
    }
  };

  return (
    <div className="card space-y-2">
      <label className="label mb-0">Saved builds</label>
      <div className="flex gap-2">
        <input className="field" placeholder="Name this build" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <button
          disabled={!build.weapon}
          onClick={save}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Save
        </button>
      </div>
      {list.length > 0 && (
        <ul className="max-h-56 divide-y divide-zinc-100 overflow-y-auto text-sm dark:divide-zinc-800">
          {ordered.map((b) => (
            <li key={b.name} className="flex items-center gap-2 py-1">
              <Star on={favs.builds.includes(b.name)} onClick={() => favs.toggleBuild(b.name)} label={b.name} />
              <button className="min-w-0 flex-1 truncate text-left hover:text-indigo-600" onClick={() => setBuild(b.build)} title="Load">
                {b.name} <span className="text-xs text-zinc-500">· {weaponName(b.build.weapon)}</span>
              </button>
              <button className="text-xs text-zinc-400 hover:text-red-600" onClick={() => update(list.filter((x) => x.name !== b.name))} aria-label={`Delete ${b.name}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-3 text-xs">
        <button className="text-indigo-600 hover:underline disabled:opacity-50" disabled={!list.length} onClick={() => downloadJson("simulacrum-builds.json", list)}>
          Export all
        </button>
        <button className="text-indigo-600 hover:underline" onClick={() => file.current?.click()}>
          Import
        </button>
        <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
      </div>
      {msg && <p className="text-xs text-zinc-500">{msg}</p>}
    </div>
  );
}
