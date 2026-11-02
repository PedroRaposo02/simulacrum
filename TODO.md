# TODO

See also `TODO-userinput.md` (the user's list, ticked as items land).

## Next (priority order)
1. ~~Forma and capacity planner~~ done. Follow-ups: stance capacity for melee; let users pin existing forma'd slots.
2. ~~Riven roll ranking~~ done (scored with fixed mods; re-optimizing per roll would be more exact but ~100x slower).
3. ~~Export JSON + Markdown~~ done.
4. ~~Favorites~~ done.
5. Niche builds page (user #17): curated / user-entered builds by purpose (primer, Heat inherit, Gas/Blast nukes).
6. Melee arcanes (user #20): Melee Influence, Melee Duplicate, Melee Crescendo etc. with their crit thresholds; zaws excluded.
7. Donate button: needs a link in `apps/web/src/site.ts`.

Working list after 0.2.0-beta.1. Checked items are done; notes say what "done" means and what's left.

## Rivens
- [x] **Wiki base values.** `data/overrides/riven.json` now holds the wiki's rank-8 base values (wiki.warframe.com/w/Riven_Mods, read 2026-11-01) per riven type, including melee-only stats (range, initial combo, heavy attack efficiency…) and spliced stats. Disposition fixed at 1.2; layouts and 0.9–1.1 roll unchanged. Flat stats (range m, combo duration s, initial combo) display with units.
- [x] **Grade a riven.** "Grade my riven" in the editor: best build around your exact riven ÷ best build with a god-roll riven ("47% of a god roll").
  - [x] Roll grade letter per stat and for the whole riven (A+ to F).

## Builds
- [x] **Realistic mode.** Optimizer option: capacity (default 60), polarity per slot (8 + exilus), drain at max rank, matching polarity halves (rounded up), mismatched +25%. Riven counts as 9.
  - [x] Stance capacity bonus from the stance data (doubled with matching polarity); forma count is planned.
- [x] **Save builds.** Named builds in browser storage, load/delete, export all / import JSON.

## Melee
- [x] **Melee stats from the wiki.** Class, attack speed, range, follow-through, combo duration, heavy damage, wind-up (Module:Weapons/data/melee).
- [x] **Stances.** Every non-Conclave stance for the weapon class (Module:Stances/data): one mode per combo (Neutral / Forward / Block / Forward Block) with per-hit damage %, hit counts, slash/puncture/impact and status multipliers. DPS = combo damage ÷ (duration ÷ attack speed). The optimizer searches the top 3 combos and keeps the best.
  - [ ] Forced procs in combos (Bleed etc.) aren't counted.
  - [ ] Wiki durations are assumed to be measured at 1.0 attack speed; verify.
- [x] **Combo showcase.** Melee summary card: best light combo at 1× and at the light combo slider (default 12×); combo-scaling mods apply per hit.
- [x] **Heavy attack builds.** Heavy mode from wiki heavy damage and wind-up; "Heavy build" optimizes it at the heavy combo slider (default 5×, Galvanized Reflex). Summary shows heavy per hit at 1× and 5×. Heavy-only bonuses (Killing Blow, "x2 for Heavy Attacks", wind-up speed) parsed.
  - [ ] Recovery after the heavy and the combo rebuild cycle aren't modelled; heavy DPS is wind-up only.
  - [ ] Whether attack speed shortens wind-up: currently assumed yes; verify.
- [x] **Tennokai.** Tennokai mode = heavy at the light build's combo (not consumed); Tennokai-only mod effects (Master's Edge, Truth's Flame, Dreamer's Wrath, Condition's Perfection) parsed; summary warns when no Tennokai mod is equipped.
  - [ ] Tennokai frequency (15% per hit, Discipline's Merit every 4 hits) into an "average DPS with Tennokai" figure.
- [x] **Comfort constraints.** Optimizer option: minimum attack speed (default 1.5; builds below it always rank lower) and "range if it costs ≤ X% DPS" (default 5%).
- [x] **Follow-through and range.** Summary shows modded range and damage across 1/2/3/5 targets using follow-through (each extra enemy takes `follow-through` × the previous one's damage).
  - [ ] Range-driven target count (how many enemies a swing reaches at a given density).

## Incarnon evolutions
- [x] **Evolution framework.** Evolutions per tier in `data/overrides/incarnon.json` (no wiki data module has them): stat modifiers, form targeting (both / Incarnon / normal), and named behaviours with tunable parameters. Editor picker per tier; optimizer chooses one per tier.
- [x] **Laetum** (from its wiki page): Rapid Wrath, Lethal Rearmament, Caput Mortuum, Elemental Excess (flat ±), Devouring Attrition (expected value on non-crit hits; off vs bosses), Overwhelming Attrition (simulated stack uptime, jointly with Enervate).
- [x] Incarnon magazine sizes from the wiki gun modules (67 of 68 weapons); damage per full charge shown.
- [x] Evolutions for all 68 Incarnon weapons, scraped from wiki pages (Genesis pages with per-variant X/Y values) and parsed: flat base damage, base crit/status/crit multiplier, flat-after-mods bonuses, per-status-type damage, multishot-only damage, crit-threshold (Prelude of Might), status-count threshold, crit↔status links, triggered/timed bonuses (uptime slider), Devouring/Overwhelming Attrition by text. Hand-curated entries in `incarnon.json` still win.
- [x] All weapon-unique evolutions modelled (option definitions in `incarnon.json` → `options`; behaviours for Flensing Spikes and King's Gambit); X/Y variant values fixed for "+Yx" and values split across lines.
- [x] Situational triggers are per-trigger scenario toggles, off by default.
- [x] Incarnon sustained DPS includes the gauge refill from weak point hits (wiki IncarnonChargeGain).
  - [ ] Melee Incarnon forms (180 s after a 6x-combo heavy) aren't cycled.

## Optimizer preferences
- [x] Arcane × evolution combinations searched globally (greedy screen of every combination, full search of the best 3, riven on the best 2). Fixes "swapping Deadhead for Enervate gains DPS" and finds low-crit Devouring Attrition builds.
- [x] Faction mods (Bane / Expel / Smite / Cleanse) and riven faction stats excluded by default; "Allow faction mods" option.

- [x] Objectives (burst / sustained / per shot / per magazine or charge) and a gun fire-rate cap for comfortable builds; spliced riven stats allowed (one per riven).
  - [ ] Confirm in-game how many spliced stats one riven can hold (currently capped at 1).

## UI
- [x] Theme selector: 7 dark + 2 light schemes (`apps/web/src/themes.css`, generated).
- [x] Warframe-style mod cards with art from the WFCD CDN; list view kept as a toggle.
  - [x] Polarity icons; drag-and-drop to swap slots.

## Buffs
- [x] Roar is a faction-type bonus (additive with Bane/Expel, double-dips on status ticks); Eclipse a separate multiplier (200% Mirage); Nourish an extra Viral mod. Subsumed (Helminth) toggle: Roar 30%, Eclipse 30%, Nourish 45%.

## Editor
- [x] The riven occupies the last normal slot in the mod list (a mod already there moves to a free slot).
- [x] Damage-buff rows no longer overlap (`.field` moved into Tailwind's components layer so width utilities apply).

## Known accuracy gaps (from earlier work)
- [x] Faction damage modifiers per enemy preset (Update 36 values).
  - [ ] Shields and Overguard (Magnetic bonus, Toxin bypass) not modelled.
- [x] Incarnon ammo per charge and recharge.
- [x] Kuva/Tenet progenitor element (60%, optimizer picks it).
- [ ] Charge-time, burst-delay and falloff modelling.
- [ ] Source-data outliers flagged by the sweep (Coda Bubonico burst).
- [ ] Laetum golden builds (need the exact build definitions).
- [ ] Verify buff defaults (Eclipse value, Roar/Eclipse stacking).
- [x] Melee arcanes (Duplicate, Doughty, Animosity, Exposure, Retaliation, Crescendo); class-restricted melee mods match the melee class.
  - [ ] Melee Influence (spreads elemental status to enemies within 20 m) and Careen (x2.5 vs frozen) are multi-target / situational: not modelled.
  - [ ] Cascadia Overcharge (overshields), Cascadia Empowered (flat damage per status), Primary Overcharge (energy), Secondary Surge, Primary Bulwark: not modelled.
