# Changelog

Versions follow [SemVer](https://semver.org). Pre-1.0 releases are betas; the version lives in `Cargo.toml` (workspace) and the `package.json` files, and each release is tagged `v<version>`.

## Unreleased

- **Data fixes**: attacks use their own multishot from the wiki (81 attacks were using the weapon's; Ballistica Prime Incarnon was 4x too high, Coda Bubonico and Boar Incarnon too); unreleased datamined mods (Soaring Truth and 4 others) dropped.
- **Raw target** is now an unarmored target that still takes Viral, so armor can only reduce damage.
- **GunCO**: per-status damage (Galvanized, Condition Overload, Fatal Affliction) adds or multiplies per attack, with its factor, from the Galvanized GunCO sheet (rainy, tests by Prof_Blocks_007).
- **Balanced objective** (new default): sustained DPS with fire rate above a comfortable rate ignored; best builds spend slots on damage and status.
- **Companion weapons**: aim-only and headshot-triggered effects ignored; Tenacious Bond and Fired Up buffs; Tenacious Bond threshold check and optimizer option; Contagious Bond spread shown.
- **Capacity and forma planner** in the card view: capacity used vs 60 (or 30), forma count and where, per-card drain and slot polarity; weapons' innate polarities are used first.
- **Exilus**: exilus eligibility now comes from WFCD's utility flag (it was ignored); best builds always fill the exilus slot.
- **UI**: bodyshot and headshot rows, burst vs sustained explained, full stat sheet, weapon type labels, Corrosive Projection slider, pagination, stronger primed and galvanized card frames, card layout, home page, logo and favicon, "Warframe Simulacrum" title, footer, best-build disclaimer.

## 0.4.0-beta.1 — 2026-11-01

- **CI and releases**: GitHub Actions run the Rust tests, golden values, sweep and web build on every push; tagging `v*` publishes a release with the website bundle and `wfcalc` for Linux, Windows and macOS.

- **Optimizer**: arcane × Incarnon evolution combinations are searched globally (each gets its own mod search), so pairings like Enervate + Overwhelming Attrition and low-crit Devouring Attrition builds are found.
- **Incarnon evolutions for all 68 Incarnon weapons**, scraped from the wiki and parsed into the engine: flat base damage, base crit/status/crit multiplier, flat-after-mods bonuses, multishot-only damage, Prelude of Might crit threshold, status-count threshold, crit↔status links, triggered bonuses; unmodelled effects are shown in the picker.
- **Optimizer objectives**: burst DPS, sustained DPS, damage per shot, or damage per magazine / Incarnon charge; a fire rate cap for comfortable gun builds; spliced riven stats (Viral, Corrosive…) allowed by default, at most one per riven.
- **Themes**: 7 dark and 2 light colour schemes, picked in the header and remembered per browser.
- **Mod cards**: Warframe-style mod view (rarity frames, art, drain and polarity, stat lines, rank pips) with a searchable picker; riven and arcane cards; the list view remains as a toggle.
- **Buffs**: Roar modelled as faction-type damage (additive with faction mods, double-dips on DoTs); subsumed (Helminth) toggle for Roar, Eclipse and Nourish with wiki values.

## 0.3.0-beta.1 — 2026-11-01

- **Rivens**: wiki base values for every riven type, including melee-only and spliced stats (flat stats shown in m / s / count); "Grade my riven" compares the best build around your riven with the best god-roll build.
- **Melee from the wiki**: stats (range, follow-through, heavy damage, wind-up) and every stance's combos become attack modes with per-hit multipliers; Heavy Attack and Tennokai modes; melee summary with 1×/12× light combo, 1×/5× heavy, Tennokai per hit, attack-speed comfort and multi-target follow-through.
- **Optimizer**: searches the top 3 combos/modes, heavy builds at the heavy combo, comfort mode (attack speed floor, range if cheap), realistic mode (capacity and slot polarities), fixed-riven grading. Marginal values use raw DPS.
- **Mods**: flat range, heavy-only damage and wind-up speed, "x2 for Heavy Attacks", Tennokai mods, plural faction names.
- **Saved builds**: save, load, delete, export and import in the editor.
- **Sweep**: per-hit gauges (heavy, Tennokai) are excluded from the outlier check.
- Ingest fetches wiki modules (`Module:Weapons/data/melee`, `Module:Stances/data`) with a 24-hour cache.
- **Incarnon evolutions**: per-tier evolutions with form targeting and behaviours (Devouring Attrition, Overwhelming Attrition, simulated jointly with Enervate); Laetum curated; editor picker; optimizer picks one per tier; Incarnon magazine sizes from the wiki.
- **Faction mods** are excluded from the optimizer by default (toggle to allow).
- **Editor**: the riven shows in its mod slot; buff rows and narrow number inputs fixed (`.field` now in the components layer).

## 0.2.0-beta.1 — 2026-11-01

- **Categories**: melee (215 weapons) and companion weapons ingested; the browser has Primary / Secondary / Melee / Arch-gun / Companion tabs. Companion weapons borrow the mod pool matching their internal path. Melee is Approximate: attack speed is used as hits per second and stance/combo multipliers aren't modelled; side attacks (slams, throws) aren't used as the headline number.
- **Theoretical best build** (`wf-opt`): greedy fill + best-improvement local search over mod swaps and element order, arcane choice, and an optional max-roll riven (3+1 or 2+1, harmless negative) searched jointly with the mods. Reports the marginal value of every piece. `pnpm optimize` precomputes builds for every weapon × enemy preset (with and without riven); the editor runs the same search on demand in a Web Worker.
- **Riven sliders**: riven range table (base × 1.2 disposition × layout × 0.9–1.1) in `data/overrides/riven.json`; each stat has a roll slider across its real range.
- **Outsourced status**: external Viral stacks, Corrosive stacks and Heat; the engine uses the higher of these and the weapon's own steady-state stacks.
- **External buffs**: Roar, Eclipse, Vex Armor, Nourish, Xata's Whisper, Arcane Avenger with ability-strength scaling and editable values (`data/overrides/buffs.json`); new `abilityDamage` multiplier pool.
- **Mechanics**: "per status type" and "per combo multiplier" modifiers (Condition Overload, Galvanized Shot, Blood Rush, Weeping Wounds); heavy attacks scale with combo; Cannonade mods (semi-auto only, fire rate locked); headshot-triggered effects toggle.
- **Fixes**: duplicate mod records now resolve to the released mod (Pressure Point was +200%); the optimizer reports the engine's actual error for uncomputable modes.

## 0.1.0-beta.1 — 2026-11-01

First beta: guns only.

- `wf-data`: data model (weapons → attack modes → hit components, modifiers with conditions).
- `wf-calc`: damage engine following the plan's order of operations, expected crit across tiers, headshots, armor DR, Viral/Corrosive/Heat steady-state stacks, burst / sustained / per-charge / approximate status DPS, explanation tree, Secondary Enervate simulation, sweep with diff and outlier detection.
- `wf-cli`: `wfcalc explain | sweep | golden`.
- `wf-wasm` + `apps/web`: weapon browser and build editor running the same engine in the browser.
- `tools/ingest`: 389 guns, 613 attack modes, 436 mods, 32 arcanes from `@wfcd/items`.
