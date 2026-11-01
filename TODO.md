# TODO

See also `TODO-userinput.md` (the user's list, ticked as items land).

## Next (priority order)
1. ~~Forma and capacity planner~~ done. Follow-ups: stance capacity for melee; let users pin existing forma'd slots.
2. Riven roll ranking per weapon (user #31): every 2-3 positive combination ranked by best-build DPS, so rolling can stop early.
3. Export JSON + Markdown (user #24): Markdown laid out like the cards; JSON re-importable.
4. Favorites for weapons and builds (user #25) with a favorites section.
5. Niche builds page (user #17): curated / user-entered builds by purpose (primer, Heat inherit, Gas/Blast nukes).
6. Melee arcanes (user #20): Melee Influence, Melee Duplicate, Melee Crescendo etc. with their crit thresholds; zaws excluded.
7. Donate button: needs a link in `apps/web/src/site.ts`.

Working list after 0.2.0-beta.1. Checked items are done; notes say what "done" means and what's left.

## Rivens
- [x] **Wiki base values.** `data/overrides/riven.json` now holds the wiki's rank-8 base values (wiki.warframe.com/w/Riven_Mods, read 2026-11-01) per riven type, including melee-only stats (range, initial combo, heavy attack efficiency…) and spliced stats. Disposition fixed at 1.2; layouts and 0.9–1.1 roll unchanged. Flat stats (range m, combo duration s, initial combo) display with units.
- [x] **Grade a riven.** "Grade my riven" in the editor: best build around your exact riven ÷ best build with a god-roll riven ("47% of a god roll").
  - [ ] Per-stat roll quality is shown on the sliders; a combined "roll grade" letter isn't.

## Builds
- [x] **Realistic mode.** Optimizer option: capacity (default 60), polarity per slot (8 + exilus), drain at max rank, matching polarity halves (rounded up), mismatched +25%. Riven counts as 9.
  - [ ] Stance/aura capacity bonus is entered by hand (add it to capacity); forma count suggestions.
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
- [ ] 21 options with weapon-unique mechanics are shown as "not modelled" (e.g. Reaver's Rapture, Stalker's Resentment, Flensing Spikes armor strip, King's Gambit, Devastation Cascade, Mounting Momentum). See `data/ingest-report.json` → `unparsedEvolutions`.
- [ ] Triggered evolution bonuses ("With Channeled Ability active", "On Shield Break"…) use the conditional-uptime slider like on-kill mods; per-trigger toggles would be more precise.
- [ ] Incarnon recharge (from weakpoint hits) for a true sustained figure.

## Optimizer preferences
- [x] Arcane × evolution combinations searched globally (greedy screen of every combination, full search of the best 3, riven on the best 2). Fixes "swapping Deadhead for Enervate gains DPS" and finds low-crit Devouring Attrition builds.
- [x] Faction mods (Bane / Expel / Smite / Cleanse) and riven faction stats excluded by default; "Allow faction mods" option.

- [x] Objectives (burst / sustained / per shot / per magazine or charge) and a gun fire-rate cap for comfortable builds; spliced riven stats allowed (one per riven).
  - [ ] Confirm in-game how many spliced stats one riven can hold (currently capped at 1).

## UI
- [x] Theme selector: 7 dark + 2 light schemes (`apps/web/src/themes.css`, generated).
- [x] Warframe-style mod cards with art from the WFCD CDN; list view kept as a toggle.
  - [ ] Real polarity icons instead of text glyphs; drag-and-drop to reorder slots.

## Buffs
- [x] Roar is a faction-type bonus (additive with Bane/Expel, double-dips on status ticks); Eclipse a separate multiplier (200% Mirage); Nourish an extra Viral mod. Subsumed (Helminth) toggle: Roar 30%, Eclipse 30%, Nourish 45%.

## Editor
- [x] The riven occupies the last normal slot in the mod list (a mod already there moves to a free slot).
- [x] Damage-buff rows no longer overlap (`.field` moved into Tailwind's components layer so width utilities apply).

## Known accuracy gaps (from earlier work)
- [ ] Health-class damage modifiers per enemy preset; shields and Overguard.
- [ ] Incarnon ammo per charge and recharge (`data/overrides/incarnon.json`).
- [ ] Charge-time, burst-delay and falloff modelling; Kuva/Tenet progenitor element.
- [ ] Source-data outliers flagged by the sweep (Coda Bubonico burst).
- [ ] Laetum golden builds (need the exact build definitions).
- [ ] Verify buff defaults (Eclipse value, Roar/Eclipse stacking).
- [ ] Melee arcanes; class-restricted melee mods (Polearms, Whips…) need weapon class matching on `compatName`.
