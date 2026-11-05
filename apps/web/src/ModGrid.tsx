import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { usePersistent } from "./persist";
import { formatRivenValue, gradeClass, layoutOf, rivenType, rollDeviation, rollGrade, rowValue, statRange } from "./riven";
import { RIVEN_SLOT, SLOT_COUNT, useStore } from "./store";
import { planCapacity, type SlotPlan } from "./capacity";
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
  finalDamage: "Damage (separate multiplier)",
  critMultMultiplier: "Critical Damage (multiplier)",
  statusDamage: "Status Damage",
  ammoEfficiency: "Ammo Efficiency",
  headshotCritChance: "Weak Point Critical Chance",
  critEnhanceChance: "Chance to Enhance Critical Hits",
  heavyEfficiency: "Heavy Attack Efficiency",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function statLine(m: Modifier, melee = false): string {
  const k = m.stat.kind;
  if (k === "range") return `${m.value > 0 ? "+" : ""}${m.value.toFixed(1)} Range`;
  if (k === "infiniteAmmoOnHeadshot") return `${Math.round(m.value * 100)}% chance on headshot: infinite ammo for ${m.threshold ?? 0}s`;
  if (k === "punchThrough") return `${m.value > 0 ? "+" : ""}${m.value.toFixed(1)} Punch Through`;
  if (k === "initialCombo") return `${m.value > 0 ? "+" : ""}${Math.round(m.value)} Initial Combo${m.condition === "onKill" ? ` on kill x${m.maxStacks ?? 1}` : ""}`;
  const pct = `${m.value > 0 ? "+" : ""}${Math.round(m.value * 1000) / 10}%`;
  let what = STAT_LABEL[k] ?? cap(m.stat.of ?? k);
  if (k === "fireRate" && melee) what = "Attack Speed";
  if (k === "baseDamage" && melee) what = "Melee Damage";
  if (k === "element" || k === "physical") what = cap(m.stat.of ?? "");
  if (k === "factionDamage") return `x${(1 + m.value).toFixed(2)} Damage to ${cap(m.stat.of ?? "")}`;
  if (k === "factionDamageAll") return `x${(1 + m.value).toFixed(2)} Damage to all`;
  if (m.appliesTo === "heavyOnly") what += " (heavy)";
  if (m.appliesTo === "tennokaiOnly") what += " (Tennokai)";
  const per =
    m.per === "statusType" ? " per status" : m.per === "comboMultiplier" ? " per combo" : m.per === "shields200" ? ` per 200 shields (max ×${m.maxStacks})` : "";
  const trig =
    m.condition && m.condition !== "always"
      ? m.condition === "headshotShare"
        ? " after a weak point hit"
        : ` ${m.condition.replace(/^on/, "on ").replace(/([A-Z])/g, " $1").toLowerCase().trim()}${m.maxStacks && m.maxStacks > 1 ? ` ×${m.maxStacks}` : ""}`
      : "";
  const situational = m.trigger ? ` [${m.trigger}]` : "";
  const scope = m.modeContains ? ` (${m.modeContains} attack)` : "";
  if (k === "critMultMultiplier") return `x${(1 + m.value).toFixed(1)} Critical Damage${trig}${situational}`;
  return `${pct} ${what}${per}${scope}${trig}${situational}`;
}

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Whether the engine models any effect of this arcane. */
export const arcaneModelled = (a: Arcane) => !!(a.behaviour || a.modifiers.length || a.stacking || a.comboFloor);

/** Effect lines for an arcane card / picker. */
export function arcaneLines(a: Arcane, melee = false): string[] {
  if (a.comboFloor) return [`Combo never below ${a.comboFloor}x`, "after enough finisher kills"];
  if (a.behaviour) return [a.description];
  if (!a.modifiers.length) return [`${a.description} (not modelled)`];
  const lines = a.modifiers.map((x) => statLine(x, melee) + (a.stacking ? " per stack" : ""));
  if (a.stacking) {
    const s = a.stacking;
    lines.push(
      s.durationS
        ? `On ${cap1(s.status)} proc, up to ${s.maxStacks} stacks (${s.durationS}s)`
        : `Per ${cap1(s.status)} stack on the target (max ${s.maxStacks})`,
    );
  }
  return lines;
}

/** What a mod does at max rank: the game's own text when known, else its stats. */
export function modLines(m: Mod, melee = false): string[] {
  if (m.effects?.length) return m.effects;
  const parts = m.modifiers.map((x) => statLine(x, melee));
  if (m.locksFireRate) parts.push("Fire rate locked");
  if (m.enablesTennokai) parts.push("Enables Tennokai");
  return parts;
}

export function modSummary(m: Mod, melee = false): string {
  return modLines(m, melee).join(" · ");
}

export const modDrain = (m: Mod) => Math.max(0, m.baseDrain + m.maxRank);

// Simple line icons for the polarities (drawn here, not game art).
const POLARITY_PATHS: Record<string, string> = {
  madurai: "M5 5 L12 19 L19 5 M9 5 L12 11 L15 5",
  vazarin: "M7 4 H12 A7 8 0 0 1 12 20 H7 Z M10 9 V15",
  naramon: "M4 13 H20 M8 9 L12 13 L16 9",
  zenurik: "M4 7 H20 M7 12 H17 M10 17 H14",
  unairu: "M5 19 L12 5 L19 19 M8.5 14 H15.5",
  penjaga: "M6 5 H18 L6 19 H18 Z",
  umbra: "M12 3 L20 12 L12 21 L4 12 Z M12 8 L16 12 L12 16 L8 12 Z",
  universal: "M12 4 V20 M5 8 L19 16 M19 8 L5 16",
};

export function PolarityIcon({ polarity, className = "h-3 w-3" }: { polarity?: string | null; className?: string }) {
  const d = polarity ? POLARITY_PATHS[polarity] : undefined;
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" className={`inline-block ${className}`} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" aria-label={polarity ?? ""}>
      <title>{polarity}</title>
      <path d={d} />
    </svg>
  );
}

// ---- Card frames (Warframe-style, independent of the page theme) -----------------------------

type Frame = { border: string; glow: string; bg: string; text: string; width?: number; inner?: string };
const FRAMES: Record<string, Frame> = {
  common: { border: "#b07d55", glow: "rgba(176,125,85,.35)", bg: "linear-gradient(180deg,#3b2b20,#17110c)", text: "#f0d6bf" },
  uncommon: { border: "#c4ccd8", glow: "rgba(196,204,216,.35)", bg: "linear-gradient(180deg,#2f343d,#121519)", text: "#e8edf4" },
  rare: { border: "#e0bb4f", glow: "rgba(224,187,79,.4)", bg: "linear-gradient(180deg,#3d3218,#17130a)", text: "#fbe7a8" },
  // Primed: thick platinum frame with a strong glow, so it stands out from gold Rares.
  legendary: { border: "#f4f1ff", glow: "rgba(236,231,255,.85)", bg: "linear-gradient(180deg,#45425a,#17161d)", text: "#ffffff", width: 3, inner: "rgba(255,255,255,.55)" },
  // Galvanized: steel frame with a cyan inner line, like the in-game card.
  galvanized: { border: "#9db4c9", glow: "rgba(110,200,230,.45)", bg: "linear-gradient(180deg,#26323d,#0d1217)", text: "#e3f4ff", width: 3, inner: "rgba(90,210,240,.75)" },
  riven: { border: "#b583ff", glow: "rgba(181,131,255,.5)", bg: "linear-gradient(180deg,#2d1d42,#120b1c)", text: "#eadbff" },
  arcane: { border: "#4fd1c5", glow: "rgba(79,209,197,.45)", bg: "linear-gradient(180deg,#14322f,#081413)", text: "#d4fffa" },
};
const frameFor = (rarity?: string, name?: string) =>
  name?.startsWith("Galvanized ") ? FRAMES.galvanized : FRAMES[(rarity ?? "common").toLowerCase()] ?? FRAMES.common;

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
  corner?: ReactNode;
  /** Small tag in the top-left corner (e.g. FORMA). */
  badge?: string;
  /** DPS this card adds on top of the rest of the build (0.5 = +50%; Infinity = needed). */
  share?: number;
  shareTitle?: string;
  pips?: number;
  label: string;
  onClick: () => void;
  /** Opens the enlarged view (also on right-click). */
  onDetails?: () => void;
}

function Card(props: CardProps) {
  const { onDetails, label, title } = props;
  if (!onDetails) return <CardFace {...props} />;
  return (
    <div
      className="relative"
      onContextMenu={(e) => {
        e.preventDefault();
        onDetails();
      }}
    >
      <CardFace {...props} />
      <button
        type="button"
        onClick={onDetails}
        aria-label={`${label}: ${title}, details`}
        title="Details (or right-click the card)"
        className="absolute bottom-1.5 right-1.5 z-10 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-[11px] text-white hover:bg-black/80"
      >
        ⤢
      </button>
    </div>
  );
}

function CardFace({ frame, title, lines, image, corner, badge, share, shareTitle, pips, label, onClick }: CardProps) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${title}`}
      title={`${title}\n${lines.join("\n")}`}
      className="group relative flex aspect-[3/4] w-full flex-col overflow-hidden rounded-lg text-left transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      style={{
        background: frame.bg,
        border: `${frame.width ?? 2}px solid ${frame.border}`,
        boxShadow: `0 0 ${frame.width ? 18 : 12}px ${frame.glow}${frame.inner ? `, inset 0 0 0 2px ${frame.inner}` : ""}`,
        color: frame.text,
      }}
    >
      {corner && (
        <span className="absolute right-1.5 top-1 z-10 rounded bg-black/50 px-1 text-[11px] font-semibold tabular-nums">{corner}</span>
      )}
      {badge && (
        <span className="absolute left-1.5 top-1 z-10 rounded bg-amber-400 px-1 text-[9px] font-bold uppercase tracking-wide text-black">{badge}</span>
      )}
      {share != null && (
        <span
          className="absolute bottom-[48%] left-1.5 z-10 mb-1 rounded bg-black/65 px-1 text-[10px] font-semibold tabular-nums"
          title={shareTitle}
        >
          {!isFinite(share) ? "needed" : share >= 0.0005 ? `+${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%` : "+0%"}
        </span>
      )}
      <div className="relative flex h-[52%] w-full items-end justify-center overflow-hidden px-2 pt-5" style={{ borderBottom: `1px solid ${frame.border}` }}>
        {image && imgOk ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            onError={() => setImgOk(false)}
            className="h-[88%] w-full rounded-sm object-cover object-center opacity-90 group-hover:opacity-100"
          />
        ) : (
          <div className="h-full w-full" style={{ background: `radial-gradient(circle at 50% 40%, ${frame.glow}, transparent 70%)` }} />
        )}
      </div>
      <div className="flex flex-1 flex-col items-center px-1.5 pb-1.5 pt-1.5 text-center">
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
            const f = frameFor(i.rarity, i.name);
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
                      {i.drain} <PolarityIcon polarity={i.polarity} />
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
type DetailState = { kind: "mod"; slot: number } | { kind: "riven" } | { kind: "arcane" } | null;

/** A dialog that closes on Escape or a click outside. */
function Dialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[6vh]" onClick={onClose} role="dialog" aria-modal="true" aria-label={label}>
      <div className="card relative w-full max-w-lg space-y-3 p-4" onClick={(e) => e.stopPropagation()}>
        <button className="absolute right-3 top-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}

const sharePct = (v: number | undefined) =>
  v == null ? null : !isFinite(v) ? "needed for the build to work" : `+${(v * 100).toFixed(v < 0.1 ? 1 : 0)}% DPS on top of the rest of the build`;

export default function ModGrid({
  weapon,
  build,
  setBuild,
  compatible,
  arcanes,
  contributions,
  vsEnemy,
}: {
  weapon: Weapon;
  build: EditorBuild;
  setBuild: (b: EditorBuild) => void;
  compatible: Mod[];
  arcanes: Arcane[];
  /** Damage share per slot index, plus "riven" and "arcane". */
  contributions?: Record<string, number> | null;
  vsEnemy?: boolean;
}) {
  const { data } = useStore();
  const [picker, setPicker] = useState<PickerState>(null);
  const [detail, setDetail] = useState<DetailState>(null);
  const [capacity, setCapacity] = usePersistent("cards.catalyst", 60);
  const shareTitle = vsEnemy
    ? "DPS this adds on top of the rest of the build, against the scenario enemy (armor and the build's own Viral/Corrosive/Heat included)"
    : "DPS this adds on top of the rest of the build, on raw weapon damage, status damage included (no armor, Viral or other enemy-side multipliers)";
  const [withStance, setWithStance] = usePersistent("cards.stance", true);
  const stanceBonus = withStance ? weapon.stanceCapacity ?? 0 : 0;
  const plan = useMemo(() => planCapacity(data!, weapon, build, capacity + stanceBonus), [data, weapon, build, capacity, stanceBonus]);
  const slotPlan = (i: number): SlotPlan => plan.slots[i];
  const corner = (i: number, fallbackPolarity?: string) => {
    const sp = slotPlan(i);
    const pol = sp.polarity && sp.polarity !== "any" ? sp.polarity : fallbackPolarity ?? "";
    return (
      <span className="inline-flex items-center gap-0.5">
        {sp.drain}
        <PolarityIcon polarity={pol} />
      </span>
    );
  };
  // Drag a normal slot onto another to swap them (slot order sets how elements combine).
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const movable = (i: number) => i < SLOT_COUNT && !(hasRiven && i === RIVEN_SLOT);
  const dragProps = (i: number) =>
    movable(i)
      ? {
          draggable: !!build.slots[i],
          onDragStart: (e: DragEvent) => {
            setDragFrom(i);
            e.dataTransfer.effectAllowed = "move";
          },
          onDragOver: (e: DragEvent) => {
            if (dragFrom == null || dragFrom === i) return;
            e.preventDefault();
            setDragOver(i);
          },
          onDragLeave: () => setDragOver((v) => (v === i ? null : v)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            if (dragFrom != null && dragFrom !== i) {
              const slots = [...build.slots];
              [slots[dragFrom], slots[i]] = [slots[i], slots[dragFrom]];
              setBuild({ ...build, slots });
            }
            setDragFrom(null);
            setDragOver(null);
          },
          onDragEnd: () => {
            setDragFrom(null);
            setDragOver(null);
          },
          className: `rounded-lg ${dragOver === i ? "ring-2 ring-indigo-500" : ""} ${dragFrom === i ? "opacity-50" : ""}`,
        }
      : {};
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
        frame={frameFor(m.rarity, m.name)}
        title={m.name}
        lines={modLines(m, melee)}
        image={m.image}
        corner={corner(i, m.polarity)}
        badge={slotPlan(i).forma ? "Forma" : undefined}
        share={contributions?.[String(i)]}
        shareTitle={shareTitle}
        pips={m.maxRank}
        onClick={() => setPicker({ kind: "mod", slot: i })}
        onDetails={() => setDetail({ kind: "mod", slot: i })}
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
        corner={corner(RIVEN_SLOT)}
        badge={slotPlan(RIVEN_SLOT).forma ? "Forma" : undefined}
        share={contributions?.riven}
        shareTitle={shareTitle}
        pips={8}
        onClick={() => document.getElementById("riven-editor")?.scrollIntoView({ behavior: "smooth", block: "center" })}
        onDetails={() => setDetail({ kind: "riven" })}
      />
    );
  };

  const arcane = arcanes.find((a) => a.name === build.arcane || a.id === build.arcane);

  const modItems = (exilus: boolean): PickerItem[] =>
    (exilus ? compatible.filter((m) => m.isExilus) : compatible)
      .filter((m) => !used.has(m.id) || (picker?.kind === "mod" && build.slots[picker.slot] === m.id))
      .map((m) => ({ id: m.id, name: m.name, rarity: m.rarity, summary: modSummary(m, melee), drain: modDrain(m), polarity: m.polarity }));

  const formaList = plan.slots
    .filter((s) => s.forma)
    .map((s) => `${s.slot === SLOT_COUNT ? "Exilus" : `Slot ${s.slot + 1}`} → ${s.riven ? "riven's polarity" : s.polarity}`);
  const innate = [...(weapon.polarities ?? []), ...(weapon.exilusPolarity ? [`exilus ${weapon.exilusPolarity}`] : [])];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={`rounded px-1.5 py-0.5 font-semibold tabular-nums ${plan.fits ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300" : "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300"}`}>
          Capacity {plan.used} / {plan.capacity}
        </span>
        {weapon.stanceCapacity ? (
          <label className="flex items-center gap-1 text-zinc-500" title="A max-rank stance adds its drain as capacity, doubled when its polarity matches the stance slot">
            <input type="checkbox" className="accent-indigo-600" checked={withStance} onChange={(e) => setWithStance(e.target.checked)} />
            Stance +{weapon.stanceCapacity}
          </label>
        ) : null}
        <span className="font-medium">{plan.forma} forma</span>
        {formaList.length > 0 && <span className="text-zinc-500">{formaList.join(" · ")}</span>}
        <label className="ml-auto flex items-center gap-1 text-zinc-500">
          <input type="checkbox" className="accent-indigo-600" checked={capacity === 60} onChange={(e) => setCapacity(e.target.checked ? 60 : 30)} />
          Orokin Catalyst / Reactor (60)
        </label>
      </div>
      <p className="-mt-1 text-[11px] text-zinc-500">
        Drain at max rank; matching polarity halves it, a different one adds 25%. Innate polarities: {innate.length ? innate.join(", ") : "none"}.
        {!plan.fits && " Even with forma on every slot this build doesn't fit: remove or swap the exilus mod (or another mod)."}

      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: SLOT_COUNT }, (_, i) =>
          hasRiven && i === RIVEN_SLOT ? (
            rivenCard()
          ) : (
            <div key={i} {...dragProps(i)}>
              {modCard(i)}
            </div>
          ),
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {modCard(SLOT_COUNT)}
        {arcanes.length > 0 &&
          (arcane ? (
            <Card
              label="Arcane"
              frame={FRAMES.arcane}
              title={arcane.name}
              lines={arcaneLines(arcane, melee).map((l) => l.slice(0, 90))}
              image={arcane.image}
              share={contributions?.arcane}
              shareTitle={shareTitle}
              pips={5}
              onClick={() => setPicker({ kind: "arcane" })}
              onDetails={() => setDetail({ kind: "arcane" })}
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

      {detail && (
        <Dialog label="Details" onClose={() => setDetail(null)}>
          {detail.kind === "mod" && build.slots[detail.slot] && modById(build.slots[detail.slot]) ? (
            <ModDetail
              mod={modById(build.slots[detail.slot])!}
              equipped={build.slots.map((id) => (id ? modById(id) : undefined)).filter((m): m is Mod => !!m)}
              share={contributions?.[String(detail.slot)]}
              drain={slotPlan(detail.slot).drain}
              polarity={slotPlan(detail.slot).polarity}
              melee={melee}
            />
          ) : detail.kind === "riven" ? (
            <RivenDetail weapon={weapon} build={build} share={contributions?.riven} />
          ) : detail.kind === "arcane" && arcane ? (
            <ArcaneDetail arcane={arcane} share={contributions?.arcane} melee={melee} />
          ) : null}
        </Dialog>
      )}

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
            summary: arcaneLines(a, melee).join(", "),
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

// ---- Details views ---------------------------------------------------------------------------

function DetailHeader({ image, title, subtitle, frame }: { image?: string; title: string; subtitle: ReactNode; frame: Frame }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <div className="flex gap-3">
      <div className="h-28 w-24 shrink-0 overflow-hidden rounded-lg" style={{ background: frame.bg, border: `2px solid ${frame.border}` }}>
        {image && imgOk ? <img src={image} alt="" className="h-full w-full object-cover" onError={() => setImgOk(false)} /> : null}
      </div>
      <div className="min-w-0 pr-6">
        <h3 className="text-lg font-semibold leading-tight">{title}</h3>
        <div className="mt-1 text-xs text-zinc-500">{subtitle}</div>
      </div>
    </div>
  );
}

function ModDetail({ mod, equipped, share, drain, polarity, melee }: { mod: Mod; equipped: Mod[]; share?: number; drain: number; polarity: string | null; melee: boolean }) {
  const { data } = useStore();
  const set = mod.set ? data!.modSets?.find((s) => s.id === mod.set) : undefined;
  const pieces = set ? equipped.filter((m) => m.set === set.id).length : 0;
  return (
    <>
      <DetailHeader
        image={mod.image}
        title={mod.name}
        frame={frameFor(mod.rarity, mod.name)}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2">
            {mod.rarity && <span>{mod.rarity}</span>}
            <span className="inline-flex items-center gap-0.5">
              Drain {drain} <PolarityIcon polarity={polarity && polarity !== "any" ? polarity : mod.polarity} />
            </span>
            <span>Rank {mod.maxRank}</span>
            {mod.isExilus && <span>Exilus</span>}
          </span>
        }
      />
      <ul className="space-y-1 text-sm">
        {modLines(mod, melee).map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {set && (
        <div className="space-y-1 rounded-md bg-zinc-100 p-2 text-xs dark:bg-zinc-800/60">
          <div className="font-semibold">
            {set.name} set: {pieces} of {set.size} pieces on this weapon
          </div>
          <ol className="space-y-0.5">
            {set.bonuses.map((b, i) => (
              <li key={i} className={i + 1 === pieces ? "font-semibold text-indigo-700 dark:text-indigo-300" : "text-zinc-500"}>
                {i + 1}: {b}
              </li>
            ))}
          </ol>
        </div>
      )}
      {sharePct(share) && <p className="text-xs text-zinc-500">{sharePct(share)}</p>}
    </>
  );
}

function ArcaneDetail({ arcane, share, melee }: { arcane: Arcane; share?: number; melee: boolean }) {
  return (
    <>
      <DetailHeader image={arcane.image} title={arcane.name} frame={FRAMES.arcane} subtitle="Arcane, rank 5" />
      <ul className="space-y-1 text-sm">
        {(arcane.description ? [arcane.description] : arcaneLines(arcane, melee)).map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {sharePct(share) && <p className="text-xs text-zinc-500">{sharePct(share)}</p>}
    </>
  );
}

function RivenDetail({ weapon, build, share }: { weapon: Weapon; build: EditorBuild; share?: number }) {
  const { data } = useStore();
  const table = data!.riven;
  if (!table) return null;
  const layout = layoutOf(table, build.riven);
  const ty = rivenType(weapon.modPool);
  const rows = [...build.riven.positives.map((r) => ({ r, neg: false })), ...(build.riven.negative ? [{ r: build.riven.negative, neg: true }] : [])];
  const graded = rows.map(({ r }) => r.roll);
  const avg = graded.length ? graded.reduce((a, b) => a + b, 0) / graded.length : null;
  const overall = avg == null ? null : rollDeviation(avg, table.rollMin, table.rollMax);
  return (
    <>
      <div className="flex items-center gap-3 pr-6">
        <div>
          <h3 className="text-lg font-semibold leading-tight">{weapon.family} Riven</h3>
          <div className="text-xs text-zinc-500">{layout ? `${layout.positives} positives${layout.negative ? " + 1 negative" : ""}` : "Incomplete"}</div>
        </div>
        {overall != null && (
          <div className="ml-auto text-center">
            <div className={`rounded px-2 py-1 text-xl font-bold ${gradeClass(rollGrade(overall))}`}>{rollGrade(overall)}</div>
            <div className="mt-0.5 text-[10px] text-zinc-500">
              {overall >= 0 ? "+" : ""}
              {overall.toFixed(1)}% avg roll
            </div>
          </div>
        )}
      </div>
      <div className="space-y-3">
        {rows.map(({ r, neg }) => {
          const def = table.stats.find((s) => s.key === r.key);
          const range = layout ? statRange(table, r.key, ty, layout, neg) : null;
          const v = layout ? rowValue(table, r, ty, layout, neg) : null;
          const dev = rollDeviation(r.roll, table.rollMin, table.rollMax);
          const g = rollGrade(dev);
          const fmtV = (x: number) => formatRivenValue(table, r.key, x);
          return (
            <div key={`${neg}-${r.key}`}>
              <div className="flex items-baseline gap-2 text-sm">
                <span className={`num font-semibold ${neg ? "text-red-600 dark:text-red-400" : ""}`}>{v != null ? fmtV(v) : ""}</span>
                <span>{def?.label ?? r.key}</span>
                <span className={`ml-auto inline-block w-7 rounded text-center text-[10px] font-bold ${gradeClass(g)}`}>{g}</span>
              </div>
              <div className="relative mt-1 h-2 rounded-full bg-gradient-to-r from-red-500/40 via-zinc-400/40 to-emerald-500/50">
                <div className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded bg-zinc-900 dark:bg-white" style={{ left: `${r.roll * 100}%` }} />
              </div>
              {range && (
                <div className="num mt-0.5 flex justify-between text-[10px] text-zinc-500">
                  <span>{fmtV(range[0])} (worst roll)</span>
                  <span>{fmtV(range[1])} (best roll)</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {sharePct(share) && <p className="text-xs text-zinc-500">{sharePct(share)}</p>}
    </>
  );
}
