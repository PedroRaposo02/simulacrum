# Changelog

Versions follow [SemVer](https://semver.org). Pre-1.0 releases are betas; the version lives in `Cargo.toml` (workspace) and the `package.json` files, and each release is tagged `v<version>`.

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
