// Favorite weapons (by id) and saved builds (by name), kept in this browser.
import { create } from "zustand";

const KEY = "simulacrum.favorites.v1";

interface Saved {
  weapons: string[];
  builds: string[];
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    return { weapons: Array.isArray(v?.weapons) ? v.weapons : [], builds: Array.isArray(v?.builds) ? v.builds : [] };
  } catch {
    return { weapons: [], builds: [] };
  }
}

function save(v: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // not persisted; favorites still work for this visit
  }
}

interface FavState extends Saved {
  toggleWeapon: (id: string) => void;
  toggleBuild: (name: string) => void;
}

const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

export const useFavorites = create<FavState>((set, get) => ({
  ...load(),
  toggleWeapon: (id) => {
    const next = { weapons: toggle(get().weapons, id), builds: get().builds };
    save(next);
    set(next);
  },
  toggleBuild: (name) => {
    const next = { weapons: get().weapons, builds: toggle(get().builds, name) };
    save(next);
    set(next);
  },
}));

export function Star({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-pressed={on}
      aria-label={on ? `Remove ${label} from favorites` : `Add ${label} to favorites`}
      title={on ? "Remove from favorites" : "Add to favorites"}
      className={`text-base leading-none ${on ? "text-amber-400" : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600"}`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
