import { useState, type ReactNode } from "react";
import type { Coverage, Explain } from "./types";
import { fmt } from "./store";

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

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
  display,
  disabled,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  display?: string;
  disabled?: boolean;
}) {
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <label className="label flex justify-between gap-2">
        <span>{label}</span>
        <span className="num normal-case">{display ?? `${Math.round(value * 100)}%`}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-indigo-600"
      />
    </div>
  );
}

export function Toggle({ label, checked, onChange, title }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-indigo-600" />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
      {options.map(([v, l]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded px-2.5 py-1 text-sm ${
            value === v ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
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
