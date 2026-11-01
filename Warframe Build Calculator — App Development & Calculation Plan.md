# Warframe Build Calculator — App Development & Calculation Plan

Oct 31, 2026 · @Lord Frost

## Overview

The app computes theoretical damage for every weapon in Warframe under any build, searches for the best build per weapon (theoretical riven included), and grades rivens you own or are rolling. One codebase ships as a Windows desktop app and as a website.

Scope is large: Overframe currently lists 545 weapons (160 primaries, 137 pistols, 215 melee, 18 archguns, 15 sentinel weapons) before counting modular weapons and every attack mode per weapon ([source](https://overframe.gg/build/315013/laetum/the-overwhelming-void-crit-laetum-orange-red-crit-possible/)). The plan treats an attack mode, not a weapon, as the unit of calculation.

**Goals**

- Every weapon, every attack mode: normal fire, Incarnon form, alt-fire, charged shots, AoE, beams, melee slam and heavy attacks.
- Burst, sustained and per-charge DPS, raw and against enemy profiles (Steel Path Grineer at the armor cap, Corpus, Infested, Overguard, bosses).
- Explainable results: every number expands into the step-by-step breakdown used in the Laetum analysis.
- A build optimizer and a riven roller that answer "what is the best build" and "is this roll good".
- Fresh data: a daily data refresh, and an alert to you whenever a weapon fails to compute or returns an implausible number.
- Calculations run on the client. The web version needs no compute backend, and the desktop version works offline.

**Not in v1**

- Importing your in-game inventory or account.
- Modelling warframe abilities beyond a list of toggleable buffs (Roar, Xata's Whisper, armor strip).
- Live riven trade prices.
- A mobile app (the website will be responsive).

## Tech stack & architecture

React + Tauri works, with one change: put the damage engine in a standalone Rust crate compiled to WebAssembly. The same `.wasm` file then runs in the browser and inside the Tauri window, so the website and the Windows app can never disagree on a number. Tauri adds only desktop extras: offline data cache, a multi-threaded native optimizer, file save/load and auto-update.

&#91;embedded content: architecture · data path and code path\]

The CLI, the website and the Windows app all run the same engine crates, and the CDN feeds game data to both apps, so a data fix reaches users without a new installer.

| Layer | Choice | Why |
| --- | --- | --- |
| Calc engine | Rust crate `wf-calc`, no I/O, compiled to WASM (wasm-bindgen) and native | One engine for web, desktop, CLI and tests |
| Shared types | Rust structs + serde, exported to TypeScript (ts-rs or specta) and JSON Schema (schemars) | One source of truth for the data model |
| Optimizer | Rust crate `wf-opt`: Web Workers + WASM on web, rayon threads via a Tauri command on desktop | Heavy search stays off the UI thread |
| UI | React + TypeScript + Vite, Zustand (state), TanStack Router and Query, Tailwind + Radix | Fast builds, small bundle, accessible components |
| Desktop shell | Tauri 2 (WebView2 on Windows) | \~10 MB installer instead of Electron's \~100 MB |
| Data pipeline | TypeScript scripts in `tools/ingest`, run by GitHub Actions on a schedule | Most sources are JSON or Lua; Node handles both easily |
| Data delivery | Versioned `gamedata-<hash>.json.br` on a CDN (Cloudflare R2 or Pages) | Data updates ship without an app release |
| Backend | None for compute; one small Cloudflare Worker for error reports and share links | Keeps hosting near-free |

Repository layout (pnpm workspace + Cargo workspace in one monorepo):

```
wf-builds/
  crates/
    wf-data/     schema types, loader, validation
    wf-calc/     damage engine (pure functions)
    wf-opt/      build optimizer
    wf-wasm/     wasm-bindgen wrapper for the browser
    wf-cli/      `wfcalc sweep`, `wfcalc explain <weapon>`
  apps/
    web/         React app (the website)
    desktop/     Tauri 2 shell around apps/web
  tools/ingest/  scrapers and normalizers -> gamedata.json
  data/overrides/ hand-written fixes and mechanic tables (versioned)
  data/golden/   expected results for regression tests
```

## Weapon data sources & ingestion pipeline

No single source has everything, so the pipeline merges four sources keyed on DE's internal item path (`/Lotus/Weapons/...`) and lets hand-written overrides win. You do not need to scrape HTML: every source below is JSON, Lua or an API.

| Source | What we take from it | Access | License / terms | Watch out for |
| --- | --- | --- | --- | --- |
| [DE Public Export](https://gamecytus.netlify.app/host-https-warframe.fandom.com/wiki/Mobile_Export) | Official base stats: damage per type, crit, status, fire rate, magazine, reload, mods (`ExportUpgrades`) | LZMA index at `origin.warframe.com/PublicExport/index_en.txt.lzma`, then hashed JSON manifests on `content.warframe.com` | Official endpoint; assets fall under WARFRAME's Content Policy | One attack per weapon; no AoE split, falloff or Incarnon form |
| [warframe-public-export-plus](https://github.com/calamity-inc/warframe-public-export-plus) | Full `behaviours` array per weapon (every projectile, AoE, cluster), arcanes, enemies | npm package or raw JSON from GitHub | No license file in the repo; ask the maintainers before redistributing | Its README says to prefer `behaviours` over `damagePerShot` |
| [Wiki Module:Weapons/data](https://wiki.warframe.com/w/Module:Weapons/data/companion) | Community-verified attacks: AoE children (`AttackParentIndex`), falloff, shot type, forced procs, Incarnon charges | MediaWiki `api.php?action=scribunto-console` returning JSON via `Module:JSON`; 8 partitions (primary, secondary, melee, archwing, companion, railjack, modular, misc) | Wiki content license applies (attribution) | Hand-edited, so typos happen; its own validator lists hundreds of key errors |
| [WFCD @wfcd/items](https://github.com/wfcd/warframe-items) | Item identity, categories, images CDN, mod level stats, patch logs | npm `@wfcd/items` | MIT | Can lag the game: its badge showed update 43.5.4 while the game is on 44.1 |
| `data/overrides` (this repo) | Incarnon evolution numbers, arcane formulas (Enervate, Cascadia Flare), GunCO table, special rules (Laetum explosion can't headshot) | YAML/JSON files you edit | Yours | The only place undocumented mechanics live |
|  |  |  |  |  |

Pipeline, run by GitHub Actions:

1. **Poll** the Public Export index every 2 hours. A changed hash means a game patch and triggers a full run; otherwise a full run happens once a day.
2. **Snapshot** every raw response into object storage, named by date and hash, so any past result can be reproduced.
3. **Parse** each source into a per-source intermediate JSON (LZMA decode, Lua-to-JSON through the wiki's `Module:JSON`).
4. **Merge** by internal path. Precedence per field: overrides > wiki attack structure > public-export-plus behaviours > Public Export base stats > WFCD metadata.
5. **Cross-check** sources against each other. Base damage, crit or fire rate differing by more than 1% between sources is flagged, not silently resolved.
6. **Validate** against the JSON Schema generated from the Rust types, plus semantic rules (crit chance 0–100%, damage > 0, every AoE child has a parent).
7. **Sweep**: run the engine on every attack of every weapon (see Failure detection). Any failure blocks publishing.
8. **Publish** `gamedata-<hash>.json.br` and a manifest to the CDN. Apps pick it up on next launch; no app release needed.

Overframe exposes richer internal weapon metadata in its page source, but scraping it is not part of the plan: it is a third-party site and the data is not offered for reuse.

## Data model

Everything the engine computes reduces to one idea: a **hit component** (one damage instance with its own crit, status and rules) modified by a list of **modifiers**. A weapon has attack modes; an attack mode fires hit components; mods, arcanes, Incarnon perks, rivens and frame buffs are all just modifiers with conditions.

```rust
struct Weapon {
    id: String,               // DE internal path, the join key
    name: String, slot: Slot, class: WeaponClass,   // Pistol, Rifle, Bow, Melee...
    family: String,           // riven family (Laetum, Braton...)
    modes: Vec<AttackMode>,   // Normal, Incarnon, Alt-fire, Charged, Heavy...
    innate: Vec<Modifier>,    // Kuva/Tenet progenitor bonus, innate multishot...
    mechanic_tags: Vec<Tag>,  // see "Covering every weapon"
    sources: Provenance,      // which source gave which field, for debugging
}

struct AttackMode {
    name: String, trigger: Trigger,
    fire_rate: f64, magazine: Option<u32>, reload: f64, charge_time: Option<f64>,
    ammo_pool: AmmoPool,      // Shared, Incarnon { rounds, recharge_s }, Battery
    components: Vec<HitComponent>,
}

struct HitComponent {
    kind: HitKind,            // Direct, Radial, Cluster, Beam, DoTCloud, Melee
    damage: DamageMap,        // Impact, Puncture, Slash, elements, Void, True
    crit_chance: f64, crit_mult: f64, status_chance: f64,
    multishot: f64,
    falloff: Option<Falloff>, radius_m: Option<f64>,
    forced_procs: Vec<ProcType>,
    rules: HitRules,          // can_headshot, receives_multishot,
                              // gun_co: Option<GunCo>, counts_as_hit_for: [...]
}

struct Modifier {
    source: SourceRef,        // mod, arcane, evolution, riven, buff
    stat: Stat,               // BaseDamage, Multishot, CritChance, Element(Heat)...
    bucket: Bucket,           // which additive pool it joins (see engine)
    value: f64, max_stacks: u8,
    applies_to: ComponentFilter,  // All, DirectOnly, RadialOnly, Headshot
    condition: Condition,     // Always, Aiming, OnKill, OnWeakPointKill, PerStatusType...
    behaviour: Option<BehaviourId>, // for mechanics a stat line can't express
}
```

| Entity | Key fields | Main source |
| --- | --- | --- |
| Mod | name, rank, polarity, drain, modifiers, exclusivity group (e.g. one multishot of each family), compatible classes | Public Export `ExportUpgrades` + WFCD |
| Arcane | rank, trigger, modifiers or behaviour id | public-export-plus + wiki `Module:Arcane/data` + overrides |
| Incarnon evolution | tier (II–V), weapon, modifiers or behaviour id | overrides (wiki pages as reference) |
| Riven | weapon family, positives, negative, rolled values, splice | user input + range tables |
| Enemy profile | faction, health type, armor, shields, Overguard, level, Steel Path, is\_boss | presets + public-export-plus `ExportEnemies` |
| Buff | external modifiers (Roar, Xata's Whisper, armor strip) | overrides |

Three design rules keep this maintainable. Stats live only in data, never in engine code. Anything a stat line can't describe becomes a named `behaviour` implemented once in Rust (Overwhelming Attrition, Devouring Attrition, Secondary Enervate, Cascadia Flare stacking). And every field carries provenance, so a wrong number can be traced to the source that produced it.

## Damage calculation engine

The engine computes the **expected** damage of each hit component in closed form, then multiplies by projectiles and rate. Mechanics that depend on history (Enervate resets, Overwhelming Attrition uptime, stacking arcanes) use a short seeded simulation instead. Every factor is recorded with its source, so the UI can show the same step-by-step breakdown as the Laetum analysis.

**Order of operations for one hit component**

1. **Base damage** per type, after innate modifiers (Kuva/Tenet progenitor bonus, Incarnon base damage).
2. **Base-damage pool**: one additive sum of every base-damage bonus (Serration-type mods, Hornet Strike, Cascadia Flare stacks, Overwhelming Attrition stacks, Secondary Deadhead, riven Damage, Anemic Agility's −15%).
3. **Physical mods** scale their own type (Impact, Puncture, Slash).
4. **Elements**: each elemental bonus adds a share of the pooled base damage. Combine pairs in mod-slot order; pre-combined sources (Magnetic Might, spliced riven elements) stay separate; innate elements combine last.
5. **Quantization**: round each damage type to multiples of the modded base ÷ 16.
6. **Faction** multiplier (applied twice for damage-over-time ticks).
7. **Crit**: expected multiplier across all crit tiers (yellow, orange, red).
8. **Weak point / headshot** multipliers, only where the component's rules allow headshots.
9. **Behaviours**: Devouring Attrition, Galvanized Shot via the GunCO table, and similar named mechanics.
10. **Enemy**: health-type modifier, armor reduction after strips, Viral on health, Magnetic on shields, Overguard rules.

```latex
B = 1 + \sum_i b_i \qquad D_e = D_{base} \cdot B \cdot p_e
```

```latex
CC = c_0\,(1 + \textstyle\sum c_i) + c_{flat} \qquad CD = d_0\,(1 + \textstyle\sum d_i) + d_{flat} \qquad M_{crit} = 1 + CC\,(CD - 1)
```

```latex
DR = 0.9\sqrt{\frac{\min(A, 2700)\,(1 - s_{heat})(1 - s_{corr})}{2700}} \qquad V_{viral} = 2 + 0.25\,(n - 1),\ 1 \le n \le 10
```

```latex
DPS_{burst} = E[\text{shot}] \cdot r \qquad DPS_{sustained} = \frac{E[\text{shot}] \cdot M}{M / r + T_{reload}} \qquad D_{charge} = E[\text{shot}] \cdot N_{rounds}
```

Here `c_flat` carries flat crit sources such as Secondary Enervate and Elemental Excess's −10%; `M` is magazine size, `r` shots per second, `T_reload` reload or Incarnon recharge time.

**Expected value vs simulation.** The closed form covers most weapons. Stateful mechanics implement a `Behaviour` trait with two methods: `expected()` when a formula exists, and `step()` for a seeded Monte Carlo run of 10,000–400,000 hits. The Enervate model from the Laetum work is the template: the simulation gave 113.9% average crit chance against the wiki's fitted 113.45%, so both paths cross-check each other.

**Status.** Proc chance is rolled per projectile; above 100%, extra procs are guaranteed. Proc type is weighted by each damage type's share. Steady-state stacks are `min(max_stacks, procs_per_s × duration)`, which is what decides whether Viral, Heat and Cascadia Flare are saturated. DoT ticks use modded base damage × multishot × faction², not elemental mods.

**Outputs per attack mode:** damage per shot, burst DPS, sustained DPS, damage per Incarnon charge, effective DPS against each enemy preset, and the explanation tree. The Laetum build A from the earlier analysis becomes the first regression vector: 400 × 17.65 × 4.263 × 3.9 × 7.07 ≈ 829,900 per shot, 14.95M burst DPS.

## Covering every weapon

"Every weapon" is reached by classifying each attack mode into mechanic families and giving every family one adapter. A weapon whose tags are all known is computed automatically; a weapon with an unknown tag is refused loudly and lands in your alert queue, never silently guessed.

Each attack mode carries a coverage status that the UI shows as a badge:

| Status | Meaning | Shown to users |
| --- | --- | --- |
| Verified | Matches a golden value measured in-game or by a community test | Normal |
| Computed | Passes all sanity checks, no golden value yet | Normal |
| Approximate | One mechanic uses a documented fallback | "Approximate" badge with the reason |
| Unsupported | Engine refused; reason recorded | Weapon page explains what's missing; you get an alert |

Mechanic families and how each is handled:

| Family | Examples | Handling |
| --- | --- | --- |
| Hitscan / projectile | Braton, Lato | Generic path |
| Direct hit + radial child | Laetum Incarnon, Kuva Bramma | Child component with its own rules (no headshots on radial, falloff) |
| Hitscan AoE that ignores multishot | Opticor, Ferrox, Mausolon | Flag `receives_multishot = false` on the AoE part |
| Charge / bow | Lanka, Paris, Nataruk | Charge time scaled by fire rate; charged vs quick-shot modes |
| Burst / spool / battery | Tenet Diplos, Gorgon, Vectis | Burst delay, spool-up ramp, battery regen in the sustained formula |
| Beam / chain | Amprex, Glaxion | Ticks per second, chain targets as a multi-target option |
| Lingering clouds and pulses | Pox, Mutalist Cernos, Alternox | DoT-cloud component; bonus only on the attached target where testers found that |
| Shotgun pellets | Hek, Boar | Multishot per pellet; status per pellet |
| Incarnon form | Laetum, Braton, Soma | Separate attack mode, Incarnon ammo pool, evolution modifiers |
| Kuva / Tenet | Kuva Chakkhurr, Tenet Arca | Progenitor element and bonus as innate modifiers |
| Thrown / speargun / glaive | Ferrox throw, Javlok | Throw mode; contact multipliers from overrides (Ferrox throw deals 3× listed) |
| Melee | Nikanas, polearms | Combo multiplier, heavy and slam attacks, stance multipliers from wiki `Module:Stances` |
| Modular | Kitguns, Zaws, Amps | Generated variants per part combination, each its own weapon |
| Exalted / companion / archgun | Exalted Blade, Verglas, Fluctus | Same engine, slot-specific mod pools |

The GunCO spreadsheet shows why overrides are unavoidable: it documents rules no data source contains, such as hitscan AoE explosions not scaling with multishot, Incarnon forms where Galvanized Shot ignores the base-damage evolution, and weapons whose Arsenal value is wrong (Acceltra loses 100% to falloff over 5 m). Each such note becomes a `HitRules` flag or override row with a link back to the sheet.

## Build optimizer

The optimizer answers "what is the best build for this weapon" by searching mods, arcane, Incarnon evolutions and a theoretical riven together, for an objective you pick. It returns the top builds plus the marginal value of every slot, the same "what each mod adds" table used in the Laetum analysis.

**Search space per weapon**

- 8 mod slots + exilus, from mods compatible with the weapon class, respecting exclusivity (one of Serration / Amalgam Serration, Primed vs normal, Galvanized vs base).
- 1 weapon arcane, Incarnon evolutions (3 choices at each of tiers II–V = 81 combinations), optional frame buffs.
- 1 riven: up to 3 positives + 1 negative from the weapon's stat list, valued at mid or max roll.
- Two capacity modes: **Theoretical** (any polarity, ignore drain) and **Realistic** (60 capacity, Orokin Reactor, the polarities you set).

**Algorithm**

1. **Prune** mods that change no stat the objective depends on, and mods dominated by another with equal or lower drain.
2. **Enumerate outer choices**: arcane × evolution path × riven stat set (riven stats limited to those that touch damage).
3. **Search mod combinations** with branch-and-bound: an upper bound from the best remaining marginal values discards most branches early. Elements are chosen as a target set (Viral + Heat, Corrosive...), and the engine derives a valid slot order, instead of trying every permutation.
4. **Polish** the top 50 builds with the stateful simulation (Enervate, Overwhelming Attrition uptime) because closed-form values can rank them slightly differently.
5. **Report** the top 10, each with its marginal-value table and one-swap alternatives.

Size check: 25 surviving mods choose 8 gives 1,081,575 combinations before bounding. Native Rust with rayon should handle that in seconds; on the web the search splits across Web Workers, so a progress bar and early best-so-far results matter. Both timings need benchmarking in milestone 3.

**Objectives**

| Objective | Use |
| --- | --- |
| Burst DPS vs enemy preset | Default (Steel Path Grineer at the armor cap) |
| Sustained DPS | Weapons where reload or Incarnon recharge dominates |
| Damage per Incarnon charge | Incarnon weapons |
| Boss DPS | Disables mechanics bosses ignore (Devouring Attrition) |
| Weighted mix | A user-set blend, e.g. 70% burst + 30% sustained |

## Rivens & the community spreadsheets

Both spreadsheets become versioned data files in `data/overrides`, imported by a script rather than retyped: the GunCO sheet feeds the engine, the good-rolls sheet feeds the riven grader. Ask the authors (rainy and Prof\_Blocks\_007 for GunCO, 44bananas for good rolls) before shipping their data, and credit them in the app.

**Riven math.** A rolled value is `base × U(0.9, 1.1) × 1.2 × layout`. The 1.2 is the fixed disposition since Hotfix 44.1.3; keep it as a data field in case DE changes it again. Layout multipliers: 0.9375 for 3 positives + 1 negative, 1.2375 for 2 + 1, 0.75 for 3 + 0. Base values per stat and weapon type, plus splice recipes (Cold + Toxin → Viral; Damage + Multishot or Zoom → Weak Point Damage), live in a range table.

**Riven features**

- **Grade a roll**: where each stat sits in its range, and how much DPS the best build with this riven reaches compared with the max-roll ideal riven ("91% of a god roll").
- **Rank stats for a weapon**: the marginal value of each riven stat in the optimizer's best build, e.g. Crit Damage +41%, Multishot +35%, Viral +31% for the Enervate Laetum.
- **Rolling advisor**: given locked or spliced traits, the chance one cycle lands an acceptable set and the expected number of cycles.
- **Sell or keep**: compares the roll with the good-rolls sheet, shown separately from DPS rank because buyers' demand and theoretical DPS differ.

**Good-rolls sheet** (44bananas, update 44.1.2): 419 weapon rows, 114 primary, 99 secondary, 174 melee, 15 archgun, 17 robotic. Each row lists positive patterns, harmless negatives and a note. The sheet's own key defines a small grammar, parsed into JSON:

```
rule  := roll ("or" roll)*
roll  := token+                  # aim for 3 positives in total
token := STAT | STAT("/"STAT)+  # bare = required, slash group = pick from pool
```

The Laetum row parses as two alternative rolls plus negatives Zoom, Recoil, Impact and Crit Chance, with the note that −Crit Chance is only harmless for the Evolution V build:

```json
{"weapon": "laetum",
 "rolls": [{"required": ["MS"], "pool": ["FR","DMG","TOX","CORRO","VIRAL"], "pick": 2},
           {"required": ["CD"], "pool": ["MS","TOX","DMG","FR","CC","CORRO","VIRAL"], "pick": 2}],
 "harmless_negatives": ["ZOOM","REC","IMP","CC"]}
```

The second roll matches the Crit Damage / Multishot / Viral riven the Enervate analysis recommended. Rows the parser can't read go to a review list instead of being guessed.

**GunCO sheet** (newest tab: 38.0.12 edition): 331 attack rows. 212 say Galvanized Shot's bonus **adds** to base damage, 89 say it **multiplies**, and the rest are untested or unknown. Each row gives a CO factor and a single-target value. Import plan:

| Column | Becomes | Fallback |
| --- | --- | --- |
| Weapon + attack name | Engine attack id via a hand-kept name map | Unmatched names listed for review |
| CO Factor | `gun_co.factor` | 1.0 |
| +Damage Math | `gun_co.mode` = Adds or Multiplies | Adds, attack marked Approximate |
| Single-Target Value | Golden check for the engine | None |
| Notes | Override flags (`receives_multishot = false`, falloff bypass) | Manual |

The sheet already agrees with the model: Laetum Incarnon has a single-target value of 0.25, the direct hit's 100 of 400 base damage. Its values were last verified on update 38.0.12, so the app should show their age and accept re-tests.

## Failure detection & developer alerting

You get alerted from three places: the data pipeline, a sweep that computes every weapon after each data change, and the app itself when a user's build fails. All three create the same thing, a deduplicated GitHub issue per weapon plus a message in your private Discord channel, so there is one queue to work from.

&#91;embedded content: alert and fix loop · 3 detectors, 1 queue\]

A fix only counts once CI's sweep is green for that weapon; until then the issue stays open and repeat failures add comments instead of new issues.

**What counts as a failure**

| Where | Failure | Example |
| --- | --- | --- |
| Ingest | Source down, schema violation, sources disagree by > 1%, new weapon with an unknown mechanic tag | A new Incarnon weapon appears with an attack type the engine has no adapter for |
| Sweep | Engine error, NaN or infinite result, zero or negative DPS | A weapon's AoE child has no parent attack |
| Sweep | Implausible result: DPS changes by > 10% with no change in that weapon's source data, or sits far outside its weapon family's range | A refactor quietly breaks charge-time scaling for every bow |
| Sweep | Golden test drift beyond tolerance | Laetum build A no longer gives 14.95M |
| App | Engine error or crash for a user's build; a user presses "This number is wrong" | A specific riven + arcane combination throws |

Thresholds are defaults in a config file, tuned once real data exists.

**The sweep.** `wfcalc sweep` runs every attack mode of every weapon against four reference builds (unmodded, generic crit, generic status, optimizer best) and every enemy preset. It writes `sweep-report.json` and diffs it with the last published report. The engine returns typed errors (`UnknownMechanic`, `MissingField`, `InvalidValue`, `NonFinite`) instead of panicking, and the WASM wrapper catches any panic as a backstop.

**Publishing rule.** A weapon that worked in the last published data and now fails blocks the publish. Weapons already known to be unsupported don't block it; they ship with the Unsupported badge so the rest of the data stays fresh.

**Alert routing**

- **GitHub issue** per failure fingerprint (`weapon_id:attack:error_code`), labelled `weapon-failure`. It contains the error, the explanation tree, field provenance and links to the raw source snapshots. Repeat failures add a comment instead of a new issue.
- **Discord webhook** to your private channel for each new fingerprint, plus one daily digest.
- **Sentry** for app crashes, tagged with weapon, attack, data version, app version and platform (React and Rust SDKs; on desktop the experimental [tauri-plugin-sentry](https://docs.rs/crate/tauri-plugin-sentry/latest/source/README.md) for Tauri 2 merges both and adds native crash minidumps). Build JSON is attached only with the user's opt-in.
- **"This number is wrong" button**: the user enters the in-game value; a Cloudflare Worker files an issue with the build attached. Confirmed reports become new golden tests.

**Fixing a weapon**

1. Open the issue and reproduce locally: `wfcalc explain <weapon> --build build.json`.
2. Fix the data (an override row) or the engine (a new adapter or behaviour).
3. Add a golden test with the expected value.
4. Open a PR; CI reruns the full sweep.
5. Merge publishes new data, and the issue closes automatically when the weapon's fingerprint goes green.

## UI/UX

Six screens cover the workflow from "which weapon" to "is my riven good". Every number on every screen can be clicked to open its explanation tree.

| Screen | What it does | Key controls |
| --- | --- | --- |
| Weapon browser | Ranks every weapon by theoretical DPS for a chosen objective and enemy | Slot, class and mechanic filters; coverage badge; enemy preset |
| Weapon page | Base stats per attack mode, Incarnon evolutions, best crit and best non-crit builds, archetype comparison (like crit vs Devouring Attrition) | Objective picker; boss toggle |
| Build editor | 8 slots + exilus, arcane, evolutions, riven, frame buffs; live burst, sustained and per-charge DPS | Condition sliders (stacks, aiming, headshot share), enemy level and armor strip |
| Optimizer | Runs the search, streams best-so-far results, shows top 10 with marginal-value tables | Objective, capacity mode, locked slots, owned-mods-only filter |
| Riven lab | Enter a riven, get its grade, % of god roll, best build with it, rolling odds and the good-rolls sell verdict | Stat pickers with range sliders; splice selector |
| Compare | Up to 4 builds side by side, plus DPS across enemy level and armor | Add from saved builds or optimizer results |

Builds are saved locally (IndexedDB on the web, an app-data folder on desktop) and export to JSON. A share link stores the build compressed in the URL, and the desktop app registers a `wfbuild://` deep link so the same link opens there.

## Testing & accuracy validation

Accuracy is tested at four levels, and the golden tests matter most: they are the only check against the actual game.

| Level | What | Tools |
| --- | --- | --- |
| Formula units | Each step of the order of operations in isolation (crit tiers, element combining, armor, quantization) | Rust `#[test]` |
| Properties | Invariants over random builds: 0% crit chance gives no crit bonus; adding a pure damage mod never lowers raw DPS; expected crit multiplier is linear in crit chance | `proptest` |
| Golden values | Known results the engine must reproduce within tolerance | `data/golden/*.json`, run in CI and in the sweep |
| App | UI flows on web and on the Windows build | Vitest, Playwright (web), WebdriverIO with `tauri-driver` (desktop) |

First golden sets, all already in hand:

- **Laetum builds** from the earlier analysis: Flare crit build 14.95M, red-crit build 6.9M, Devouring Attrition build 22.1M, Enervate build 21.0M burst DPS.
- **GunCO single-target values**: every numeric row of the sheet becomes an assertion on how much Galvanized Shot adds to that attack.
- **Enervate average crit chance**: the wiki's fitted formula against the engine's simulation (113.45% vs 113.9% at 22% modded crit chance).
- **Unmodded per-shot damage** for every weapon against the wiki's and Public Export's listed totals.

Two more checks run in CI. Native and WASM builds must produce identical results for the same input and seed (no fast-math, fixed seeds). And every pull request gets a comment summarising the sweep diff: weapons whose numbers changed, by how much, and why.

## Build, deployment & distribution

One GitHub repository produces three artifacts, each with its own update path. Game data updates never require an app release, which is what keeps the app current between Warframe patches.

| Artifact | Built by | Hosted at | How users get updates |
| --- | --- | --- | --- |
| Website | Vite static build + WASM | Cloudflare Pages (Vercel or Netlify also work) | Every merge to `main` deploys; a service worker caches the app and data for offline use |
| Windows app | `tauri build` via tauri-action in GitHub Actions; NSIS `-setup.exe` (MSI optional) | GitHub Releases | Tauri updater plugin reads a static `latest.json` from the latest release |
| Game data | Ingest pipeline | Cloudflare R2 behind a CDN | Both apps check the data manifest at launch and download the new bundle |

**Windows specifics**

- Prefer the NSIS installer: it can be built off Windows and handles per-user updates more smoothly than MSI.
- Sign the installer with an Authenticode certificate (a PFX, or a cloud signing service) so SmartScreen stops warning users; the certificate is the project's one recurring cost.
- Updates are signed separately with a Tauri updater key pair; Tauri's docs warn that losing the private key means existing installs can never receive updates again, so store it in a password manager and in GitHub secrets.
- Use the WebView2 bootstrapper install mode so older Windows 10 machines without WebView2 still install.

**CI/CD workflows**

| Trigger | Jobs |
| --- | --- |
| Pull request | clippy, eslint, Rust + TS tests, WASM build, sweep against current data, preview deploy, sweep-diff comment |
| Merge to `main` | Deploy website |
| Tag `v*` | Build, sign and publish the Windows installer and `latest.json` |
| Every 2 hours | Check the Public Export index hash; run the full pipeline if it changed |
| Daily | Full pipeline run, sweep, publish data, Discord digest |

Sources: [Tauri updater plugin docs](https://v2.tauri.app/plugin/updater/).

## Roadmap & milestones

Guns come first because they share one engine path and the Laetum and GunCO data already give golden tests; melee, modular weapons and the desktop shell follow once the web beta proves the numbers.

&#91;embedded content: roadmap · 5 phases, 5 gates\]

The web beta is the gate that matters: it is the first point where real users can report wrong numbers, which feeds the golden tests for everything after it.

## Risks, licensing & open questions

The biggest constraint is licensing, not code: wiki data is non-commercial share-alike, so the app should stay free and publish its data bundle under the same terms.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Wiki content is licensed CC BY-NC-SA 3.0 ([footer](https://wiki.warframe.com/w/User:Unduku)) | No paywall, attribution required, derived data must stay share-alike | Free app; data bundle under CC BY-NC-SA with a credits page; engine code can still be MIT |
| [DE Content Policy](https://warframe.com/videopolicy): non-commercial use, passive ads allowed, no Warframe or DE logos without written consent | A paid tier or logo use could get the app taken down | No charge for access; own branding; ads only if the wiki license question below is settled |
| warframe-public-export-plus has no license file | Redistributing its data may not be allowed | Ask the maintainers; fallback is Public Export + wiki only |
| Spreadsheet authors haven't agreed yet | Can't ship GunCO or good-rolls data | Ask on Discord; credit them in-app |
| DE changes mechanics in patches (riven disposition was retired in Hotfix 44.1.3) | Silent wrong numbers | Overrides with "last verified" versions, sweep, staleness badges |
| A source changes its API or URL | Pipeline stops | Several sources, raw snapshots, apps keep the last good data |
| Undocumented mechanics | Some weapons stay approximate | Approximate badge, "this number is wrong" reports, community tests |
| Browser optimizer too slow | Poor web experience | Pruning, Web Workers, best-so-far streaming; heavy search on desktop |
| Scope: 545+ weapons, melee stances, modular weapons | Burnout before launch | Ship guns first (roadmap), deduplicated alerts and a daily digest |

**Open questions for you**

- [ ] Should frame buffs (Roar, Xata's Whisper) be on by default, or theoretical weapon-only numbers?
- [ ] Ads or no ads? DE allows passive ads, but CC BY-NC-SA's non-commercial clause makes ad revenue on wiki-derived data risky; no ads is the safe default.
- [ ] Open-source the engine? It invites community fixes to mechanics, which is how the spreadsheets above got built.

## Sources

- [Module:Weapons/data documentation (attack schema, export API)](https://wiki.warframe.com/w/Module:Weapons/data/companion)
- [Module:Arcane/data documentation](https://wiki.warframe.com/w/Module:Arcane/data/doc)
- [Public Export endpoint notes](https://gamecytus.netlify.app/host-https-warframe.fandom.com/wiki/Mobile_Export)
- [warframe-public-export-plus](https://github.com/calamity-inc/warframe-public-export-plus)
- [WFCD warframe-items](https://github.com/wfcd/warframe-items)
- [Tauri updater plugin](https://v2.tauri.app/plugin/updater/)
- [tauri-plugin-sentry](https://docs.rs/crate/tauri-plugin-sentry/latest/source/README.md)
- [Warframe Content Policy](https://warframe.com/videopolicy)
- Community spreadsheets: *Galvanized GunCO on Projectiles* (38.0.12 edition, by rainy, tests by Prof\_Blocks\_007) and *good rolls for selling* (update 44.1.2, by 44bananas), as uploaded
