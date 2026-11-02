# Changelog

Versions follow [SemVer](https://semver.org). Pre-1.0 releases are betas; the version lives in `Cargo.toml` (workspace) and the `package.json` files, and each release is tagged `v<version>`.

## 0.5.0-beta.1 — 2026-11-02

- **Heavy attack builds** aim for a comfortable heavy: about +100% speed over the unmodded heavy (wind-up and attack speed together). The Balanced objective requires it when reachable and values nothing past it.

- **Melee attack speed** is valued like gun fire rate in the Balanced objective: past +60% over the weapon's base it counts for nothing, so builds take one attack speed mod and spend the rest on damage. New **Arcane Strike** buff (+60% melee attack speed) fills that on its own.
- **Fury, Primed Fury and Berserker Fury** are mutually exclusive (as in game); best builds used to pair Berserker Fury with Primed Fury.
- **Optimizer**: fixed a hang on explosive weapons with a riven (the forced explosion-radius mod could be dropped to make room, and the search never ended); riven roll ranking keeps the best build's progenitor element; changing the scenario re-runs the last search.

- **Settings persist**: the scenario (enemy, buffs, conditions, triggers), the open build and tab, optimizer options, comfort settings, weapon list category/sort/favorites filter and the card view's capacity toggles are remembered in the browser.
- **Settings page**: save the current scenario as your default (Scenario › Reset goes back to it), reset optimizer options / list filters / view preferences / everything, and export or import one backup file with all settings, saved builds and favorites.

- **Melee arcanes**: Melee Duplicate (yellow crits strike again: x(1 + share of tier-1 crits), so the best crit chance is near (3·CD−4)/(2·CD−2)), Doughty (crit multiplier from Puncture status chance, on the Puncture part), Animosity (+420% crit chance on heavies), Exposure (+240% Corrosive), Retaliation (per 200 shields; new shields slider), Crescendo (combo never below 12x). Zaw arcanes excluded; Influence, Careen and utility arcanes shown as not modelled.
- **Status-driven arcanes**: Primary Blight, Primary Frostbite, Conjunction Voltage and Cascadia Flare build stacks from the weapon's own procs (shared timer; full stacks once procs outpace it); Secondary Shiver scales with the Cold stacks the weapon keeps on the target.
- **Shotgun Vendetta** (shotguns) and **Longbow Sharpshot** (bows, x4 on shots after a weak point hit, scaled by the headshot share) in the primary arcane slot.
- **Class-restricted melee mods** (Boreal's, Nira's and Amar's Contempt, Covert Lethality…) now fit their weapon class; they fitted nothing before.
- **Incarnon evolutions: all modelled** (0 left as "not modelled", was 21): Flensing Spikes (armor strip per Puncture stack), King's Gambit (no bodyshot crits, +150% on weak points), Critical Parallel and Survivor's Edge (per-variant values were not filled in), Reaver's Rapture, Mounting Momentum, Devastation Cascade (charged blast only), Steadfast Grit, Stalker's Resentment; Sawblade Storm and Renewed Horror have no single-target effect.
- **Incarnon sustained DPS** includes refilling the gauge: weak point hits in normal form (any direct hit for Angstrum and Torid) at the wiki's charge per hit, with the normal form's damage counted meanwhile. New "Incarnon charging: weak point hit share" condition (50% default).
- **Situational triggers** ("with overshields", "with channeled ability active", "on shield break", energy/armor/sprint thresholds…) are off by default and toggled per trigger in the Scenario panel; they used to count as always active. Cascadia Overcharge uses "with overshields".
- **Enemy damage modifiers** (Update 36): Grineer take x1.5 Impact and Corrosive, Corpus x1.5 Puncture and Magnetic, Infested x1.5 Slash and Heat, DoT ticks included. Steel Path Grineer numbers rise for Corrosive builds.
- **Kuva / Tenet progenitor element**: 60% of base damage as an innate element (combines after mod elements); the optimizer picks the best of the 7, the editor has a picker.
- **Stance capacity**: melee capacity includes the best stance's bonus (doubled with a matching polarity), toggleable in the card view; the optimizer's exilus rule uses it too.
- **Riven grade**: A+ to F per stat and for the whole riven, from the roll's distance to the centre of its range.
- **Card view**: drawn polarity icons instead of text glyphs; drag a mod onto another slot to swap them (slot order sets element combination).
- **Card percentages** are measured on the weapon's raw damage by default (no armor, Viral or other status); "% vs enemy" switches to the scenario enemy.

- **Optimizer rules**: explosive weapons always carry an explosion-radius mod (toggle) and ignore headshot effects; the exilus gets a fitting utility mod (beam range, projectile speed, recoil) and is dropped if the build can't fit 60 capacity even with forma; Adhesive Blast is never used and Heavy Caliber only when nothing else comes within 5%; Balanced caps fire rate at +150% over the weapon's base (comfort option sets your own cap); changing an optimizer option re-runs the last search.
- **One-round magazines** (Lenz, bows with reload per shot): burst DPS includes the reload after every shot; the weapon list sorts by sustained DPS by default.
- **Editor**: live stats next to the mod cards (toggle); each card shows how much DPS it adds on top of the rest ("needed" when the build can't work without it); "Most DPS Build" naming.
- **Weapons**: Sirocco (an amp-style Drifter weapon) excluded; Rumblejack kept as melee.

- **Data fixes**: attacks use their own multishot from the wiki (81 attacks were using the weapon's; Ballistica Prime Incarnon was 4x too high, Coda Bubonico and Boar Incarnon too); unreleased datamined mods (Soaring Truth and 4 others) dropped.
- **Raw target** is now an unarmored target that still takes Viral, so armor can only reduce damage.
- **GunCO**: per-status damage (Galvanized, Condition Overload, Fatal Affliction) adds or multiplies per attack, with its factor, from the Galvanized GunCO sheet (rainy, tests by Prof_Blocks_007).
- **Balanced objective** (new default): sustained DPS with fire rate above a comfortable rate ignored; best builds spend slots on damage and status.
- **Companion weapons**: aim-only and headshot-triggered effects ignored; Tenacious Bond and Fired Up buffs; Tenacious Bond threshold check and optimizer option; Contagious Bond spread shown.
- **Capacity and forma planner** in the card view: capacity used vs 60 (or 30), forma count and where, per-card drain and slot polarity; weapons' innate polarities are used first.
- **Favorites**: star weapons and saved builds; favorites filter and home-page section.
- **Export**: build to JSON (re-importable) and/or Markdown laid out like the cards.
- **Riven roll ranking**: every 2-3 positive roll for a weapon ranked against the best one (riven editor), with a Use button.
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
