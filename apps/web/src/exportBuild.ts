// Build export: JSON the app can import back (saved-builds format) and Markdown that reads like
// the card view in any text editor or Markdown viewer.
import { modSummary, statLine } from "./ModGrid";
import { formatRivenValue, layoutOf, rivenType, rowValue } from "./riven";
import { RIVEN_SLOT, SLOT_COUNT, fmt } from "./store";
import type { BuildResult, EditorBuild, GameData, SavedBuild, Weapon } from "./types";
import { weaponTypeLabel } from "./labels";

export function buildJson(name: string, build: EditorBuild): SavedBuild[] {
  return [{ name, savedAt: Date.now(), build }];
}

export function buildMarkdown(data: GameData, weapon: Weapon, build: EditorBuild, result: BuildResult | undefined, scenarioNote: string): string {
  const melee = weapon.slot === "melee";
  const out: string[] = [];
  out.push(`# ${weapon.name}`);
  out.push("");
  out.push(`*${weaponTypeLabel(weapon)} · ${result?.target ?? ""}*  `);
  out.push(`*${scenarioNote}*`);
  out.push("");
  if (weapon.image) out.push(`![${weapon.name}](${weapon.image})`, "");

  const best = result?.modes.reduce((a, m) => (!a || m.burstDps > a.burstDps ? m : a), undefined as (typeof result.modes)[number] | undefined);
  if (best) {
    out.push(`## Damage (${best.mode})`, "");
    out.push("| Per shot | Burst DPS | Sustained DPS | Fire rate |");
    out.push("|---:|---:|---:|---:|");
    out.push(`| ${fmt(best.perShot)} | ${fmt(best.burstDps)} | ${fmt(best.sustainedDps)} | ${best.fireRate.toFixed(2)}/s |`);
    out.push("");
  }

  out.push("## Mods", "");
  const hasRiven = build.riven.positives.length > 0;
  const rows: string[] = [];
  for (let i = 0; i <= SLOT_COUNT; i++) {
    const slot = i === SLOT_COUNT ? "Exilus" : `${i + 1}`;
    if (hasRiven && i === RIVEN_SLOT) {
      const table = data.riven!;
      const layout = layoutOf(table, build.riven);
      const ty = rivenType(weapon.modPool);
      const lines = [...build.riven.positives.map((r) => [r, false] as const), ...(build.riven.negative ? [[build.riven.negative, true] as const] : [])].map(([r, neg]) => {
        const v = layout ? rowValue(table, r, ty, layout, neg) : null;
        const label = table.stats.find((s) => s.key === r.key)?.label ?? r.key;
        return `${v == null ? "" : formatRivenValue(table, r.key, v) + " "}${label}`;
      });
      rows.push(`| ${slot} | **${weapon.family} Riven** | ${lines.join("<br>")} |`);
      continue;
    }
    const m = data.mods.find((x) => x.id === build.slots[i]);
    if (!m) continue;
    const img = m.image ? `<img src="${m.image}" width="48"> ` : "";
    rows.push(`| ${slot} | ${img}**${m.name}** (${m.rarity ?? ""}) | ${m.modifiers.map((x) => statLine(x, melee)).join("<br>") || modSummary(m, melee)} |`);
  }
  out.push("| Slot | Mod | Effect |", "|---|---|---|", ...rows, "");

  const arcane = data.arcanes.find((a) => a.name === build.arcane || a.id === build.arcane);
  if (arcane) out.push("## Arcane", "", `**${arcane.name}** — ${arcane.description}`, "");
  if (build.evolutions?.length) out.push("## Incarnon evolutions", "", ...build.evolutions.map((e) => `- ${e}`), "");

  if (best) {
    const c = best.components[0];
    out.push("## Stats", "");
    out.push(`- Critical chance: ${(c.critChance * 100).toFixed(1)}%`);
    out.push(`- Critical multiplier: ${c.critMult.toFixed(2)}x`);
    out.push(`- Status chance: ${(c.statusChance * 100).toFixed(1)}%`);
    out.push(`- Projectiles per shot: ${c.projectiles.toFixed(2)}`);
    if (best.magazine != null) out.push(`- Magazine: ${best.magazine} · reload ${best.reloadS.toFixed(2)} s`);
    out.push(`- Damage: ${Object.entries(c.damage).map(([t, v]) => `${t} ${fmt(v)}`).join(", ")}`);
    out.push("");
  }
  out.push(`---`, `*Exported from Warframe Simulacrum. Numbers are model estimates.*`);
  return out.join("\n");
}
