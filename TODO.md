# TODO

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
- [ ] Evolutions for the other ~67 Incarnon weapons (each needs its wiki page read into `incarnon.json`).
- [ ] Incarnon recharge (from weakpoint hits) for a true sustained figure.

## Optimizer preferences
- [x] Faction mods (Bane / Expel / Smite / Cleanse) and riven faction stats excluded by default; "Allow faction mods" option.

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
