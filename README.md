# Warframe Simulacrum

A weapon build calculator for Warframe. Pick a weapon, put mods, arcanes, a riven and Incarnon
evolutions on it, and see what it actually does against a real enemy: per shot, burst and sustained
DPS, status damage, and how it performs against a group. An optimizer finds the strongest build
for any weapon, and every weapon in the game comes ranked with its precomputed best builds.

Everything runs on your machine. The damage engine is written in Rust and compiled to WebAssembly,
so the website is a set of static files with no server behind it. It can be installed from the
browser as an app that works offline, and there is a desktop app for Windows, macOS and Linux
that updates itself with each release.

**Website: https://pedroraposo02.github.io/simulacrum/** · Desktop app:
[releases](https://github.com/PedroRaposo02/simulacrum/releases)

> Beta. Numbers are a model of the game, not a recording of it; see [Accuracy](#accuracy-and-limits).

---

## Features

**Weapon browser**
- Every primary, secondary, melee, arch-gun and companion weapon (600+), ranked by DPS against
  the chosen enemy.
- Each weapon shown unmodded, with its best build, or with its best build plus a max-roll riven.
- Single target or group fight; light or heavy attacks for melee.
- Favorites, categories, search.

**Build editor**
- Mod cards with polarities, drain, capacity and forma planning; drag and drop between slots.
- Arcanes, Incarnon evolutions, Kuva/Tenet progenitor element, rivens with real roll ranges.
- Live stats: damage by type, crit, status, multishot, fire rate, magazine, reload.
- How much each mod adds, as a percentage of the build's DPS (raw or against the enemy).
- An explanation tree showing every step of the calculation.

**Optimizer**
- Finds the best build for a weapon with your scenario: enemy, buffs, outsourced status, group size.
- Objectives: balanced (default), burst, sustained, per shot, per charge, group fight.
- Comfort limits (fire rate, attack speed, heavy wind-up), required and banned mods, minimum
  crit chance (Tenacious Bond), realistic capacity and polarities.
- Searches arcanes, Incarnon evolutions and riven stats together; runs in a background worker.

**Rivens**
- Grade a riven you own against the stat's roll range.
- Rank every 2–3 positive roll for a weapon against the best one.
- Find the best riven for a build, including the spliced stats.

**Compare**
- Two or three builds of one weapon side by side: DPS, stats, damage types, and what differs in
  the mods, arcane, riven and evolutions.

**Scenario**
- Enemy presets (Steel Path Grineer, Corpus, Infested, armored boss) with faction modifiers,
  armor and health; armor strip, Corrosive Projection, outsourced Viral, Corrosive and Heat.
- Warframe buffs (Roar, Eclipse, Xata's Whisper…) with ability strength.
- Headshot share, conditional uptime, situational triggers, group size, fight length,
  distance to target, Contagious Bond.

**Everything else**
- Saved builds, share links, JSON and Markdown export.
- Settings that persist, with backup and restore.
- Themes; installable from the browser (offline, its own window).
- Desktop app ([releases](https://github.com/PedroRaposo02/simulacrum/releases)): Windows
  installer, macOS dmg, Linux AppImage; offers new releases on launch and updates in place.

---

## How damage is calculated

The engine follows the game's order of operations for each attack mode and each hit component
(a projectile, its explosion, a beam tick…):

1. **Base damage** by damage type, plus flat and percentage mods. Mods add up within their stat;
   different stats multiply.
2. **Elements** combine in slot order (Heat + Toxin = Gas, and so on), then the weapon's innate
   elements and the progenitor element.
3. **Crits** are averaged over crit tiers; Puncture and Cold procs on the target add crit chance
   and crit damage.
4. **Multishot, faction damage and enemy modifiers**: faction mods apply twice to status ticks,
   as in the game.
5. **Armor**: reduced by armor strip, Corrosive stacks and Heat. Viral stacks multiply health
   damage.
6. **Status damage over time**: Slash, Heat, Toxin, Electricity and Gas ticks, and Blast
   detonations, scaled by Status Damage mods. Stacks are averaged over the fight length.
7. **Fire rate, magazine, reload, charge time and ammo cost** turn damage per shot into DPS.

The results it reports:

| Metric | Meaning |
| --- | --- |
| Per shot | One trigger pull or swing against the enemy |
| Burst DPS | Firing without reloading, status damage included |
| Sustained DPS | Including reloads (and the Incarnon gauge refill) |
| Per charge | One full charge, for charge weapons |
| Group DPS | Against a group of enemies 5 m apart: explosion radius with falloff, punch through, chaining beams, melee range and follow-through, Electricity arcs, Gas clouds, Blast, Melee Influence, enemy deaths |

Melee builds also model combo, heavy attacks (combo rebuilt between heavies, Heavy Attack
Efficiency, Initial Combo), Tennokai, stance forced procs, and the melee arcanes.

---

## Accuracy and limits

- **Best builds are theoretical.** They assume conditional effects (on-kill, on-headshot buffs)
  are always up unless you lower their uptime, and any mod polarity.
- **Not modelled yet:** shields and Overguard, burst delay on burst-fire weapons, kill-based ammo
  refunds, a few arcanes. The app marks mods and arcanes it can't model.
- **Data** comes from community sources (below), which can lag behind game updates. Numbers that
  look wrong are worth reporting.

---

## Project layout

```
crates/wf-data     data model: weapons, attack modes, hit components, mods, arcanes, enemies
crates/wf-calc     damage engine
crates/wf-opt      optimizer: best build, riven search, riven ranking
crates/wf-cli      wfcalc command-line tool
crates/wf-wasm     WebAssembly wrapper used by the website
apps/web           website: React, Vite, Tailwind, zustand
apps/desktop       desktop app (Tauri): the website in a native window, plus signed updates
tools/ingest       builds data/gamedata.json from the data sources and the overrides
tools/merge-best-builds.mjs   merges best-build slices computed in parallel
tools/updater-manifest.mjs    writes the desktop update manifest (latest.json) for a release
data/overrides     hand-kept data: arcane and Incarnon effects, enemies, riven table, buffs,
                   mod exclusivity, chaining beams, optimizer rules
data/golden        regression tests against known in-game values
```

How the pieces fit:

```
WFCD items + wiki + GunCO sheet + data/overrides
        │  tools/ingest
        ▼
 data/gamedata.json ──► Rust engine (wf-calc, wf-opt)
                           ├─► wfcalc CLI ──► data/best-builds.json
                           └─► WebAssembly ──► website (loads gamedata.json + best-builds.json)
```

---

## Development

Requirements: Rust (stable) with the `wasm32-unknown-unknown` target, `wasm-pack`, Node 22 and
pnpm 10.

```sh
pnpm install
pnpm ingest            # refresh data/gamedata.json from the sources
pnpm build:wasm        # compile the engine for the website
pnpm dev               # website on http://localhost:5173
pnpm test              # Rust tests
pnpm optimize          # recompute data/best-builds.json for every weapon (~1 h; log in data/best-builds.log)
pnpm desktop:dev       # desktop app against the dev server
pnpm desktop:build     # desktop installer (apps/desktop/src-tauri/target/release/bundle)
```

`pnpm ingest` caches wiki downloads for 24 hours in `tools/ingest/.cache` (`--refresh` to force).
After changing the engine (`crates/`), run `pnpm build:wasm` again. Best builds go stale when the
engine or data changes; the website says so when the data version differs.

### Command line

```sh
wfcalc explain Laetum --mods "Hornet Strike,Barrel Diffusion" --enemy sp-grineer
wfcalc optimize Laetum --enemy sp-grineer --riven
wfcalc optimize "Nikana Prime" --heavy
wfcalc optimize Verglas --objective group --fight-s 60 --fixed-riven SDMG,CC
wfcalc optimize Laetum --capacity 60 --polarities madurai,madurai,-,-,-,-,-,-,-
wfcalc optimize --all --shard 0/16 --out part-0.json
wfcalc sweep
wfcalc golden
```

`wfcalc <command> --help` lists every option. From the repository, use
`cargo run --release -p wf-cli -- <command>`.

---

## Releases and deployment

Branches:

- **`dev`**: day-to-day work. Every push runs CI (`.github/workflows/ci.yml`): engine tests,
  golden values, sweep and a website build.
- **`production`**: what's released. Merging `dev` into `production` and pushing releases the
  version in `package.json` as tag `v<version>`; a push whose version was already released does
  nothing, so bump the version first. Pushing a `v*` tag or running the workflow by hand
  releases that tag.

A release (`.github/workflows/release.yml`):

1. **Website, right away.** The site is built and deployed to GitHub Pages with the best builds of
   the previous release, so the new version is live within minutes.
2. **Best builds.** Every weapon × enemy × build variant is optimized on 16 parallel runners (one
   would exceed GitHub's 6-hour job limit) and merged.
3. **Website, final.** The site is deployed again with the new best builds.
4. **Desktop app** for Windows, macOS and Linux, built from the final website and signed for
   updates (`TAURI_SIGNING_PRIVATE_KEY` secret; the public key is in
   `apps/desktop/src-tauri/tauri.conf.json`).
5. **GitHub Release** with notes from `CHANGELOG.md`, the installers, the update manifest
   (`latest.json`), the website as a zip, `best-builds.json` (used by the next release's first
   deploy) and `wfcalc` for Linux, Windows and macOS.

The desktop app checks the releases on launch; when a newer one has a `latest.json`, it offers
to download, verify and install it, then restarts.

The website is served by GitHub Pages; only `production` and `v*` tags may deploy to it (the
`github-pages` environment).
Versions live in `Cargo.toml`, `apps/desktop/src-tauri/Cargo.toml` and the `package.json` files
(the desktop app reads `apps/desktop/package.json`); tags with a suffix are pre-releases.

---

## Fan project

Simulacrum is a free, non-commercial fan project. It isn't affiliated with, endorsed or sponsored
by Digital Extremes. Warframe and its logos are trademarks of Digital Extremes Ltd.; the project
doesn't use them as its own branding. Game data and weapon images belong to their owners and are
used for reference. Donations are voluntary, cover the project's costs and don't unlock anything.

## Data sources

- [WFCD items](https://github.com/WFCD/warframe-items) (MIT): weapons, mods, arcanes, images.
- [Warframe wiki](https://wiki.warframe.com) (CC BY-NC-SA 3.0): melee and stance data, per-attack
  stats, riven stat values.
- The Galvanized GunCO on Projectiles sheet (tests by Prof_Blocks_007).

## License

The code is licensed under the [GNU Affero General Public License v3.0](LICENSE) or later: you
can use, study, change and share it, and anything built from it, including a modified copy of
the website that you run for others, has to be shared under the same license with its source.

Data derived from the Warframe wiki (`data/gamedata.json`, `data/best-builds.json`) stays under
CC BY-NC-SA 3.0, so it can't be used commercially.
