import { useState } from "react";
import type { Coverage, Explain } from "./types";
import { fmt, useStore } from "./store";

const BADGE: Record<Coverage, string> = {
  verified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
  computed: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300",
  approximate: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  unsupported: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
};

export function CoverageBadge({ c, title }: { c: Coverage; title?: string }) {
  return (
    <span title={title} className={`rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${BADGE[c]}`}>
      {c}
    </span>
  );
}

export function EnemyPicker() {
  const { data, target, setTarget } = useStore();
  return (
    <select className="field" value={target.enemy ?? ""} onChange={(e) => setTarget({ ...target, enemy: e.target.value || null })}>
      <option value="">Raw (no enemy)</option>
      {data!.enemies.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
        </option>
      ))}
    </select>
  );
}

export function ExplainTree({ node, depth = 0 }: { node: Explain; depth?: number }) {
  const [open, setOpen] = useState(depth < 1);
  const kids = node.children ?? [];
  return (
    <div style={{ paddingLeft: depth ? 14 : 0 }}>
      <button
        className="flex w-full items-baseline gap-2 py-0.5 text-left text-sm hover:text-indigo-600 disabled:hover:text-inherit"
        disabled={!kids.length}
        onClick={() => setOpen(!open)}
      >
        <span className="w-3 text-zinc-400">{kids.length ? (open ? "▾" : "▸") : ""}</span>
        <span>{node.label}</span>
        <span className="num ml-auto font-medium">{fmt(node.value)}</span>
      </button>
      {node.detail && <div className="pl-5 text-xs text-zinc-500">{node.detail}</div>}
      {open && kids.map((c, i) => <ExplainTree key={i} node={c} depth={depth + 1} />)}
    </div>
  );
}
