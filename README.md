# Simulacrum — Warframe build calculator

Implementation of `Warframe Build Calculator — App Development & Calculation Plan.md`, phase 1 (guns).

## Layout

```
crates/wf-data   data model (weapons, attack modes, hit components, modifiers)
crates/wf-calc   damage engine, behaviours (Enervate sim), sweep
crates/wf-opt    build optimizer (best build with / without riven, marginal values)
crates/wf-cli    `wfcalc explain | sweep | golden`
crates/wf-wasm   wasm-bindgen wrapper used by the web app
apps/web         React + Vite + Tailwind UI (weapon browser, build editor)
tools/ingest     builds data/gamedata.json from @wfcd/items + wiki melee/stance modules + data/overrides
data/overrides   hand-kept fixes: mod exclusivity, arcane behaviours, Incarnon ammo, enemy presets,
                 riven range table, external buff presets
data/golden      regression vectors
```

## Commands

```sh
pnpm install
pnpm ingest                      # -> data/gamedata.json (+ apps/web/public copy)
pnpm optimize                    # -> data/best-builds.json (+ public copy), ~1 min
pnpm test                        # all Rust tests
cargo run --release -p wf-cli -- explain Laetum --mods "Hornet Strike,Barrel Diffusion" --enemy sp-grineer
cargo run --release -p wf-cli -- optimize Laetum --enemy sp-grineer [--riven]
cargo run --release -p wf-cli -- optimize "Nikana Prime" --heavy            # heavy build at 5x combo
cargo run --release -p wf-cli -- optimize "Nikana Prime" --min-attack-speed 1.8 --range-tolerance 0.05
cargo run --release -p wf-cli -- optimize Laetum --capacity 60 --polarities madurai,madurai,-,-,-,-,-,-,-
cargo run --release -p wf-cli -- sweep [--previous old-report.json]
cargo run --release -p wf-cli -- golden
pnpm build:wasm && pnpm dev      # web app on http://localhost:5173
```

`pnpm ingest` downloads two wiki modules (cached for 24 h in `tools/ingest/.cache`, `--refresh` to force).
Wiki data is CC BY-NC-SA 3.0, so the app and its data stay non-commercial.

Requires Rust with `wasm32-unknown-unknown` and `wasm-pack`. After changing `crates/`, run
`pnpm build:wasm` and `pnpm optimize` (best builds go stale when the engine or data changes;
the browser warns when the data version differs).

## Releases

Every push to `main` runs CI (`.github/workflows/ci.yml`). Pushing a tag `vX.Y.Z[-beta.N]` runs
`.github/workflows/release.yml`: it builds the WASM engine, precomputes best builds, bundles the
website (`simulacrum-web-<tag>.zip`, static files that work from any folder) and builds `wfcalc`
for Linux, Windows and macOS, then publishes a GitHub Release with notes from `CHANGELOG.md`.
Tags with a suffix (`-beta.1`) are marked as pre-releases.
