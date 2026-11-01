import type { Weapon } from "./types";

const CLASS: Record<string, string> = {
  rifle: "Rifle",
  shotgun: "Shotgun",
  sniper: "Sniper",
  bow: "Bow",
  launcher: "Launcher",
  pistol: "Pistol",
  secondaryShotgun: "Shotgun pistol",
  thrown: "Throwing",
  archGun: "Arch-gun",
  melee: "Melee",
};

const POOL_KIND: Record<string, string> = {
  primary: "rifle-type",
  shotgun: "shotgun-type",
  secondary: "pistol-type",
  melee: "melee",
  archGun: "arch-gun",
};

/** "Beam" for held-trigger weapons, otherwise the trigger, for the weapon's first attack. */
function fireStyle(w: Weapon & { modes: { trigger?: string }[] }): string | null {
  const t = (w.modes[0] as { trigger?: string } | undefined)?.trigger;
  switch (t) {
    case "held":
      return "Beam";
    case "auto":
      return "Auto";
    case "semi":
      return "Semi-auto";
    case "burst":
      return "Burst";
    case "charge":
      return "Charge";
    case "duplex":
      return "Duplex";
    default:
      return null;
  }
}

/** e.g. "Shotgun · Auto", "Beam rifle-type companion weapon", "Nikana". */
export function weaponTypeLabel(w: Weapon): string {
  if (w.melee) return w.melee.class;
  if (w.slot === "companion") {
    const style = fireStyle(w);
    return `${style ? style + " " : ""}${POOL_KIND[w.modPool] ?? ""} companion weapon`.trim();
  }
  const cls = w.class === "rifle" && w.slot === "secondary" ? "Pistol" : CLASS[w.class] ?? w.class;
  const style = fireStyle(w);
  return style ? `${cls} · ${style}` : cls;
}
