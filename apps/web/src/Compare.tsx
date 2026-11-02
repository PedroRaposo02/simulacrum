import { Fragment, useMemo, useState, type ReactNode } from "react";
import { buildFromBest, COMPARE_MAX, compute, emptyBuild, engineBuild, fmt, loadSaved, targetKey, useStore, type CompareColumn } from "./store";
import { formatRivenValue, layoutOf, rivenType, rowValue } from "./riven";
import { TYPE_LABEL } from "./BuildEditor";
import type { BestPair, EditorBuild, ModeResult, Weapon } from "./types";

const BEST_LABEL: [keyof BestPair, string][] = [
  ["plain", "Most DPS"],
  ["riven", "Most DPS + riven"],
  ["groupPlain", "Group fight"],
  ["groupRiven", "Group fight + riven"],
  ["heavyPlain", "Heavy attack"],
  ["heavyRiven", "Heavy attack + riven"],
  ["heavyGroupPlain", "Heavy, group fight"],
  ["heavyGroupRiven", "Heavy, group fight + riven"],
];

/** The build's main attack: the headline mode with the most burst DPS. */
function mainMode(weapon: Weapon, modes: ModeResult[]): ModeResult | undefined {
  const headline = modes.filter((m) => weapon.modes[m.modeIndex]?.headline !== false);
  return (headline.length ? headline : modes).reduce<ModeResult | undefined>((a, m) => (!a || m.burstDps > a.burstDps ? m : a), undefined);
}

const delta = (v: number, base: number) => {
  if (!(base > 0) || !isFinite(v)) return null;
  const d = v / base - 1;
  if (Math.abs(d) < 0.0005) return <span className="text-zinc-400">=</span>;
  return <span className={d > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{`${d > 0 ? "+" : ""}${(d * 100).toFixed(1)}%`}</span>;
};

/** Two or three builds of one weapon side by side: DPS, stats and what differs in the build. */
export default function Compare() {
  const { data, engine, best, build: editorBuild, scenario, compare, setCompare, addToCompare, setBuild, setTab } = useStore();
  const [modeChoice, setModeChoice] = useState<number | "main">("main");
  const weaponId = compare[0]?.build.weapon ?? editorBuild.weapon;
  const weapon = data!.weapons.find((w) => w.id === weaponId);
  const saved = useMemo(() => loadSaved().filter((b) => b.build.weapon === weaponId), [weaponId]);
  const pair = weapon ? best?.targets[targetKey(scenario.target)]?.[weapon.id] : undefined;
  const modName = (id: string) => data!.mods.find((m) => m.id === id)?.name ?? id;

  const results = useMemo(
    () =>
      compare.map((c) => {
        const r = compute(engine!, engineBuild(data!, c.build, scenario), scenario.target).ok;
        if (!r || !weapon) return undefined;
        return modeChoice === "main" ? mainMode(weapon, r.modes) : r.modes.find((m) => m.modeIndex === modeChoice);
      }),
    [compare, engine, data, scenario, weapon, modeChoice],
  );

  const sources: { key: string; label: string; build: () => EditorBuild }[] = weapon
    ? [
        ...(editorBuild.weapon === weapon.id ? [{ key: "editor", label: "Build editor (current)", build: () => editorBuild }] : []),
        ...saved.map((b) => ({ key: `saved:${b.name}`, label: `Saved: ${b.name}`, build: () => b.build })),
        ...BEST_LABEL.flatMap(([k, label]) => {
          const e = pair?.[k];
          return e && typeof e === "object" ? [{ key: `best:${k}`, label: `Best: ${label}`, build: () => buildFromBest(data!, weapon, e) }] : [];
        }),
        { key: "empty", label: "Unmodded", build: () => emptyBuild(weapon.id) },
      ]
    : [];

  const pickWeapon = (id: string) => {
    setCompare([]);
    if (id) setBuild(editorBuild.weapon === id ? editorBuild : emptyBuild(id));
  };
  const add = (key: string) => {
    const s = sources.find((x) => x.key === key);
    if (s) addToCompare({ label: s.label.replace(/^(Saved|Best): /, ""), build: s.build() });
  };
  const remove = (i: number) => setCompare(compare.filter((_, j) => j !== i));
  const rename = (i: number, label: string) => setCompare(compare.map((c, j) => (j === i ? { ...c, label } : c)));
  const edit = (c: CompareColumn) => {
    setBuild(c.build);
    setTab("build");
  };

  const cols = compare.length;
  const grid = { gridTemplateColumns: `minmax(9rem, 12rem) repeat(${Math.max(cols, 1)}, minmax(11rem, 1fr))` };
  const section = (title: string) => (
    <div className="col-span-full mt-3 border-b border-zinc-200 pb-1 text-xs font-semibold uppercase text-zinc-500 dark:border-zinc-800">{title}</div>
  );
  // A numeric row: value per build, change against the first build, best value highlighted.
  const numRow = (label: string, get: (m: ModeResult) => number | null | undefined, show: (v: number) => string = fmt, higherIsBetter = true) => {
    const vals = results.map((m) => (m ? get(m) : null));
    if (vals.every((v) => v == null)) return null;
    const nums = vals.filter((v): v is number => v != null && isFinite(v));
    const top = nums.length > 1 && new Set(nums).size > 1 ? (higherIsBetter ? Math.max(...nums) : Math.min(...nums)) : null;
    return (
      <Fragment key={label}>
        <div className="py-1 text-sm text-zinc-500">{label}</div>
        {vals.map((v, i) => (
          <div key={i} className="num flex items-baseline gap-2 py-1 text-sm">
            <span className={v != null && v === top ? "font-semibold text-indigo-600 dark:text-indigo-400" : ""}>{v == null ? "—" : show(v)}</span>
            {i > 0 && v != null && vals[0] != null && <span className="text-xs">{delta(v, vals[0])}</span>}
          </div>
        ))}
      </Fragment>
    );
  };
  const textRow = (label: string, cells: ReactNode[]) => (
    <Fragment key={label}>
      <div className="py-1 text-sm text-zinc-500">{label}</div>
      {cells.map((c, i) => (
        <div key={i} className="py-1 text-sm">
          {c}
        </div>
      ))}
    </Fragment>
  );

  // Mods in every build are plain; mods only some builds use are highlighted.
  const modSets = compare.map((c) => c.build.slots.filter(Boolean));
  const inAll = (id: string) => modSets.every((s) => s.includes(id));
  const damageTypes = [...new Set(results.flatMap((m) => (m ? Object.keys(m.components[0]?.damage ?? {}) : [])))].sort(
    (a, b) => Math.max(...results.map((m) => m?.components[0]?.damage[b] ?? 0)) - Math.max(...results.map((m) => m?.components[0]?.damage[a] ?? 0)),
  );
  const table = data!.riven;
  const rivenLines = (b: EditorBuild) => {
    if (!table || !weapon || !b.riven.positives.length) return "—";
    const layout = layoutOf(table, b.riven);
    const ty = rivenType(weapon.modPool);
    const rows = [...b.riven.positives.map((r) => ({ r, neg: false })), ...(b.riven.negative ? [{ r: b.riven.negative, neg: true }] : [])];
    return (
      <ul className="space-y-0.5">
        {rows.map(({ r, neg }) => {
          const v = layout ? rowValue(table, r, ty, layout, neg) : null;
          const label = table.stats.find((s) => s.key === r.key)?.label ?? r.key;
          return (
            <li key={r.key} className={neg ? "text-red-600 dark:text-red-400" : ""}>
              {v != null ? formatRivenValue(table, r.key, v) : ""} {label}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <label className="label">Weapon</label>
          <select className="field" value={weaponId} onChange={(e) => pickWeapon(e.target.value)}>
            <option value="">Choose a weapon…</option>
            {[...data!.weapons]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
        </div>
        {weapon && (
          <>
            <div className="min-w-[14rem] flex-1">
              <label className="label">Add a build ({cols}/{COMPARE_MAX})</label>
              <select className="field" value="" disabled={cols >= COMPARE_MAX} onChange={(e) => add(e.target.value)}>
                <option value="">{cols >= COMPARE_MAX ? "Remove one to add another" : "Choose…"}</option>
                {sources.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[12rem]">
              <label className="label">Attack</label>
              <select className="field" value={String(modeChoice)} onChange={(e) => setModeChoice(e.target.value === "main" ? "main" : Number(e.target.value))}>
                <option value="main">Each build&apos;s main attack</option>
                {weapon.modes.map((m, i) => (
                  <option key={i} value={i}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {!weapon && <p className="text-zinc-500">Pick a weapon, then add two or three of its builds.</p>}
      {weapon && cols === 0 && (
        <p className="text-zinc-500">
          Add builds from the list above: the build editor, your saved builds or the precomputed best builds. In the build editor, &ldquo;Compare&rdquo; adds the
          current build.
        </p>
      )}
      {weapon && cols > 0 && (
        <div className="card overflow-x-auto">
          <p className="mb-2 text-xs text-zinc-500">
            {weapon.name} vs {results.find(Boolean) ? `${scenario.target.enemy ?? "raw target"}` : "—"}, with the scenario on the left. Changes are against the
            first build; the best value in a row is highlighted.
          </p>
          <div className="grid min-w-max gap-x-4" style={grid}>
            <div />
            {compare.map((c, i) => (
              <div key={i} className="space-y-1 border-b border-zinc-200 pb-2 dark:border-zinc-800">
                <input className="field py-1 text-sm font-semibold" value={c.label} onChange={(e) => rename(i, e.target.value)} aria-label="Build name" />
                <div className="flex gap-3 text-xs">
                  <button className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => edit(c)}>
                    Open in editor
                  </button>
                  <button className="text-zinc-500 hover:text-red-600" onClick={() => remove(i)}>
                    Remove
                  </button>
                </div>
                <div className="text-xs text-zinc-500">{results[i]?.mode ?? "No result"}</div>
              </div>
            ))}

            {section("Damage")}
            {numRow("Burst DPS", (m) => m.burstDps)}
            {numRow("Sustained DPS", (m) => m.sustainedDps)}
            {numRow("Group DPS", (m) => m.groupDps)}
            {numRow("Group sustained", (m) => m.groupSustainedDps)}
            {numRow("Per shot", (m) => m.perShot)}
            {numRow("Per charge", (m) => m.perCharge)}
            {numRow("Status DPS", (m) => m.statusDps)}
            {numRow("Raw burst DPS", (m) => m.burstDpsRaw)}

            {section("Stats")}
            {numRow("Critical chance", (m) => m.components[0]?.critChance, (v) => `${(v * 100).toFixed(1)}%`)}
            {numRow("Critical multiplier", (m) => m.components[0]?.critMult, (v) => `${v.toFixed(2)}×`)}
            {numRow("Status chance", (m) => m.components[0]?.statusChance, (v) => `${(v * 100).toFixed(1)}%`)}
            {numRow("Multishot", (m) => m.components[0]?.projectiles, (v) => v.toFixed(2))}
            {numRow("Damage per projectile", (m) => m.components[0] && Object.values(m.components[0].damage).reduce((a, b) => a + b, 0))}
            {damageTypes.map((t) => numRow(`· ${TYPE_LABEL[t] ?? t}`, (m) => m.components[0]?.damage[t] ?? 0))}
            {numRow(weapon.melee ? "Attack speed" : "Fire rate", (m) => m.attackSpeed ?? m.fireRate, (v) => v.toFixed(2))}
            {!weapon.melee && numRow("Magazine", (m) => m.magazine, (v) => String(v))}
            {!weapon.melee && numRow("Reload", (m) => m.reloadS, (v) => `${v.toFixed(2)} s`, false)}
            {numRow("Range", (m) => m.rangeM, (v) => `${v.toFixed(2)} m`)}
            {numRow("Viral stacks", (m) => m.viralStacks, (v) => v.toFixed(1))}
            {numRow("Corrosive stacks", (m) => m.corrosiveStacks, (v) => v.toFixed(1))}

            {section("Build")}
            {textRow(
              "Mods",
              compare.map((c, i) => (
                <ul key={i} className="space-y-0.5">
                  {modSets[i].length ? (
                    modSets[i].map((id) => (
                      <li key={id} className={inAll(id) ? "" : "font-medium text-indigo-600 dark:text-indigo-400"}>
                        {modName(id)}
                      </li>
                    ))
                  ) : (
                    <li className="text-zinc-400">None</li>
                  )}
                </ul>
              )),
            )}
            {textRow(
              "Arcane",
              compare.map((c) => c.build.arcane ?? "—"),
            )}
            {textRow(
              "Riven",
              compare.map((c) => rivenLines(c.build)),
            )}
            {!!weapon.evolutions?.length &&
              textRow(
                "Evolutions",
                compare.map((c) => (c.build.evolutions.filter(Boolean).length ? c.build.evolutions.filter(Boolean).join(", ") : "—")),
              )}
            {weapon.progenitor &&
              textRow(
                "Progenitor",
                compare.map((c) => c.build.progenitor ?? "—"),
              )}
          </div>
          {cols > 1 && <p className="mt-3 text-xs text-zinc-500">Highlighted mods are the ones not every build uses.</p>}
        </div>
      )}
    </div>
  );
}
