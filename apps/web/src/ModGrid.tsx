import { useEffect, useMemo, useRef, useState } from "react";
import { formatRivenValue, layoutOf, rivenType, rowValue } from "./riven";
import { RIVEN_SLOT, SLOT_COUNT, useStore } from "./store";
import type { Arcane, EditorBuild, Mod, Modifier, Weapon } from "./types";

// ---- Text helpers ---------------------------------------------------------------------------

const STAT_LABEL: Record<string, string> = {
  baseDamage: "Damage",
  multishot: "Multishot",
  critChance: "Critical Chance",
  critChanceFlat: "Critical Chance (flat)",
  critDamage: "Critical Damage",
  statusChance: "Status Chance",
  statusChanceFlat: "Status Chance (flat)",
  fireRate: "Fire Rate",
  magazine: "Magazine Capacity",
  reloadSpeed: "Reload Speed",
  headshotDamage: "Headshot Damage",
  statusDuration: "Status Duration",
  abilityDamage: "Damage (ability)",
  windUpSpeed: "Heavy Wind Up Speed",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function statLine(m: Modifier, melee = false): string {
  const k = m.stat.kind;
  if (k === "range") return `${m.value > 0 ? "+" : ""}${m.value.toFixed(1)} Range`;
  const pct = `${m.value > 0 ? "+" : ""}${Math.round(m.value * 1000) / 10}%`;
  let what = STAT_LABEL[k] ?? cap(m.stat.of ?? k);
  if (k === "fireRate" && melee) what = "Attack Speed";
  if (k === "baseDamage" && melee) what = "Melee Damage";
  if (k === "element" || k === "physical") what = cap(m.stat.of ?? "");
  if (k === "factionDamage") return `x${(1 + m.value).toFixed(2)} Damage to ${cap(m.stat.of ?? "")}`;
  if (k === "factionDamageAll") return `x${(1 + m.value).toFixed(2)} Damage to all`;
  if (m.appliesTo === "heavyOnly") what += " (heavy)";
  if (m.appliesTo === "tennokaiOnly") what += " (Tennokai)";
  const per = m.per === "statusType" ? " per status" : m.per === "comboMultiplier" ? " per combo" : "";
  const trig =
    m.condition && m.condition !== "always"
      ? ` ${m.condition.replace(/^on/, "on ").replace(/([A-Z])/g, " $1").toLowerCase().trim()}${m.maxStacks && m.maxStacks > 1 ? ` ×${m.maxStacks}` : ""}`
      : "";
  return `${pct} ${what}${per}${trig}`;
}

export function modSummary(m: Mod, melee = false): string {
  const parts = m.modifiers.map((x) => statLine(x, melee));
  if (m.locksFireRate) parts.push("Fire rate locked");
  if (m.enablesTennokai) parts.push("Enables Tennokai");
  return parts.join(", ") || "No modelled effect";
}

export const modDrain = (m: Mod) => Math.max(0, m.baseDrain + m.maxRank);

const POLARITY_GLYPH: Record<string, string> = {
  madurai: "V",
  vazarin: "D",
  naramon: "—",
  zenurik: "≡",
  unairu: "◣",
  penjaga: "⧖",
  umbra: "◆",
  universal: "∗",
};

// ---- Card frames (Warframe-style, independent of the page theme) -----------------------------

type Frame = { border: string; glow: string; bg: string; text: string };
const FRAMES: Record<string, Frame> = {
  common: { border: "#b07d55", glow: "rgba(176,125,85,.35)", bg: "linear-gradient(180deg,#3b2b20,#17110c)", text: "#f0d6bf" },
  uncommon: { border: "#c4ccd8", glow: "rgba(196,204,216,.35)", bg: "linear-gradient(180deg,#2f343d,#121519)", text: "#e8edf4" },
  rare: { border: "#e0bb4f", glow: "rgba(224,187,79,.4)", bg: "linear-gradient(180deg,#3d3218,#17130a)", text: "#fbe7a8" },
  legendary: { border: "#ece7ff", glow: "rgba(236,231,255,.55)", bg: "linear-gradient(180deg,#3a3846,#16151c)", text: "#ffffff" },
  riven: { border: "#b583ff", glow: "rgba(181,131,255,.5)", bg: "linear-gradient(180deg,#2d1d42,#120b1c)", text: "#eadbff" },
  arcane: { border: "#4fd1c5", glow: "rgba(79,209,197,.45)", bg: "linear-gradient(180deg,#14322f,#081413)", text: "#d4fffa" },
};
const frameFor = (rarity?: string) => FRAMES[(rarity ?? "common").toLowerCase()] ?? FRAMES.common;

function Pips({ n }: { n: number }) {
  const count = Math.min(n, 10);
  return (
    <div className="flex justify-center gap-[3px]">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="h-[5px] w-[5px] rotate-45" style={{ background: "currentColor", opacity: 0.85 }} />
      ))}
    </div>
  );
}

interface CardProps {
  frame: Frame;
  title: string;
  lines: string[];
  image?: string;
  corner?: string;
  pips?: number;
  label: string;
  onClick: () => void;
}

function Card({ frame, title, lines, image, corner, pips, label, onClick }: CardProps) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${title}`}
      title={`${title}\n${lines.join("\n")}`}
      className="group relative flex aspect-[3/4] w-full flex-col overflow-hidden rounded-lg text-left transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      style={{ background: frame.bg, border: `2px solid ${frame.border}`, boxShadow: `0 0 12px ${frame.glow}`, color: frame.text }}
    >
      {corner && (
        <span className="absolute right-1.5 top-1 z-10 rounded bg-black/50 px-1 text-[11px] font-semibold tabular-nums">{corner}</span>
      )}
      <div className="relative h-[42%] w-full overflow-hidden" style={{ borderBottom: `1px solid ${frame.border}` }}>
        {image && imgOk ? (
          <img src={image} alt="" loading="lazy" onError={() => setImgOk(false)} className="h-full w-full object-cover opacity-90 group-hover:opacity-100" />
        ) : (
          <div className="h-full w-full" style={{ background: `radial-gradient(circle at 50% 40%, ${frame.glow}, transparent 70%)` }} />
        )}
      </div>
      <div className="flex flex-1 flex-col items-center px-1.5 pb-1.5 pt-1 text-center">
        <div className="line-clamp-2 text-[12px] font-semibold leading-tight">{title}</div>
        <div className="mt-0.5 line-clamp-4 text-[10.5px] leading-snug opacity-85">
          {lines.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
        <div className="mt-auto pt-1">{pips ? <Pips n={pips} /> : null}</div>
      </div>
    </button>
  );
}

function EmptyCard({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Add to ${label}`}
      className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-zinc-300 text-zinc-400 hover:border-indigo-500 hover:text-indigo-500 dark:border-zinc-700 dark:text-zinc-500"
    >
      <span className="text-2xl leading-none">+</span>
      <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      {hint && <span className="px-2 text-center text-[10px]">{hint}</span>}
    </button>
  );
}

// ---- Picker ---------------------------------------------------------------------------------

interface PickerItem {
  id: string;
  name: string;
  rarity?: string;
  summary: string;
  drain?: number;
  polarity?: string;
}

function Picker({
  title,
  items,
  current,
  onPick,
  onClear,
  onClose,
}: {
  title: string;
  items: PickerItem[];
  current?: string;
  onPick: (id: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => i.name.toLowerCase().includes(s) || i.summary.toLowerCase().includes(s)) : items;
  }, [q, items]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 p-4 pt-[8vh]" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="card flex max-h-[80vh] w-full max-w-2xl flex-col gap-2 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{title}</h3>
          <span className="text-xs text-zinc-500">{shown.length} options</span>
          {onClear && current && (
            <button className="ml-auto text-sm text-red-600 hover:underline" onClick={onClear}>
              Remove
            </button>
          )}
          <button className={`${onClear && current ? "" : "ml-auto"} text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200`} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <input ref={input} className="field" placeholder="Search by name or effect…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="-mx-1 flex-1 overflow-y-auto">
          {shown.map((i) => {
            const f = frameFor(i.rarity);
            return (
              <li key={i.id}>
                <button
                  onClick={() => onPick(i.id)}
                  className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${i.id === current ? "bg-indigo-50 dark:bg-indigo-950/40" : ""}`}
                >
                  <span className="h-8 w-1.5 shrink-0 rounded" style={{ background: f.border }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{i.name}</span>
                    <span className="block truncate text-xs text-zinc-500">{i.summary}</span>
                  </span>
                  {i.drain != null && (
                    <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                      {i.drain} {POLARITY_GLYPH[i.polarity ?? ""] ?? ""}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {!shown.length && <li className="px-2 py-4 text-sm text-zinc-500">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}

// ---- Grid -----------------------------------------------------------------------------------

type PickerState = { kind: "mod"; slot: number } | { kind: "arcane" } | null;

export default function ModGrid({
  weapon,
  build,
  setBuild,
  compatible,
  arcanes,
}: {
  weapon: Weapon;
  build: EditorBuild;
  setBuild: (b: EditorBuild) => void;
  compatible: Mod[];
  arcanes: Arcane[];
}) {
  const { data } = useStore();
  const [picker, setPicker] = useState<PickerState>(null);
  const melee = weapon.slot === "melee";
  const hasRiven = build.riven.positives.length > 0;
  const modById = (id: string) => data!.mods.find((m) => m.id === id);
  const used = new Set(build.slots.filter(Boolean));

  const setSlot = (i: number, id: string) => {
    const slots = [...build.slots];
    slots[i] = id;
    setBuild({ ...build, slots });
    setPicker(null);
  };

  const modCard = (i: number) => {
    const label = i === SLOT_COUNT ? "Exilus" : `Slot ${i + 1}`;
    const m = build.slots[i] ? modById(build.slots[i]) : undefined;
    if (!m) return <EmptyCard key={i} label={label} onClick={() => setPicker({ kind: "mod", slot: i })} />;
    return (
      <Card
        key={i}
        label={label}
        frame={frameFor(m.rarity)}
        title={m.name}
        lines={m.modifiers.map((x) => statLine(x, melee)).concat(m.locksFireRate ? ["Fire rate locked"] : [])}
        image={m.image}
        corner={`${modDrain(m)} ${POLARITY_GLYPH[m.polarity] ?? ""}`}
        pips={m.maxRank}
        onClick={() => setPicker({ kind: "mod", slot: i })}
      />
    );
  };

  const rivenCard = () => {
    const table = data!.riven;
    const layout = table ? layoutOf(table, build.riven) : undefined;
    const ty = rivenType(weapon.modPool);
    const rows = [...build.riven.positives.map((r) => ({ r, neg: false })), ...(build.riven.negative ? [{ r: build.riven.negative, neg: true }] : [])];
    const lines = rows.map(({ r, neg }) => {
      const def = table?.stats.find((s) => s.key === r.key);
      const v = table && layout ? rowValue(table, r, ty, layout, neg) : null;
      return `${v == null || !table ? "" : formatRivenValue(table, r.key, v) + " "}${def?.label ?? r.key}`;
    });
    return (
      <Card
        key="riven"
        label="Riven"
        frame={FRAMES.riven}
        title={`${weapon.family} Riven`}
        lines={lines}
        corner="18 ◆"
        pips={8}
        onClick={() => document.getElementById("riven-editor")?.scrollIntoView({ behavior: "smooth", block: "center" })}
      />
    );
  };

  const arcane = arcanes.find((a) => a.name === build.arcane || a.id === build.arcane);

  const modItems = (exilus: boolean): PickerItem[] =>
    (exilus ? compatible.filter((m) => m.isExilus) : compatible)
      .filter((m) => !used.has(m.id) || (picker?.kind === "mod" && build.slots[picker.slot] === m.id))
      .map((m) => ({ id: m.id, name: m.name, rarity: m.rarity, summary: modSummary(m, melee), drain: modDrain(m), polarity: m.polarity }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: SLOT_COUNT }, (_, i) => (hasRiven && i === RIVEN_SLOT ? rivenCard() : modCard(i)))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {modCard(SLOT_COUNT)}
        {arcanes.length > 0 &&
          (arcane ? (
            <Card
              label="Arcane"
              frame={FRAMES.arcane}
              title={arcane.name}
              lines={arcane.modifiers.length ? arcane.modifiers.map((x) => statLine(x, melee)) : [arcane.description.slice(0, 90)]}
              image={arcane.image}
              pips={5}
              onClick={() => setPicker({ kind: "arcane" })}
            />
          ) : (
            <EmptyCard label="Arcane" onClick={() => setPicker({ kind: "arcane" })} />
          ))}
        {!hasRiven && (
          <EmptyCard
            label="Riven"
            hint="Add stats in the riven editor; it takes slot 8"
            onClick={() => document.getElementById("riven-editor")?.scrollIntoView({ behavior: "smooth", block: "center" })}
          />
        )}
      </div>

      {picker?.kind === "mod" && (
        <Picker
          title={picker.slot === SLOT_COUNT ? "Exilus mod" : `Mod for slot ${picker.slot + 1}`}
          items={modItems(picker.slot === SLOT_COUNT)}
          current={build.slots[picker.slot]}
          onPick={(id) => setSlot(picker.slot, id)}
          onClear={() => setSlot(picker.slot, "")}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "arcane" && (
        <Picker
          title="Arcane"
          items={arcanes.map((a) => ({
            id: a.name,
            name: a.name,
            rarity: "arcane",
            summary: a.behaviour || a.modifiers.length ? (a.modifiers.length ? a.modifiers.map((x) => statLine(x, melee)).join(", ") : a.description) : `${a.description} (not modelled)`,
          }))}
          current={build.arcane ?? undefined}
          onPick={(id) => {
            setBuild({ ...build, arcane: id });
            setPicker(null);
          }}
          onClear={() => {
            setBuild({ ...build, arcane: null });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
