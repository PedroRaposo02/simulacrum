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
tools/ingest     builds data/gamedata.json from @wfcd/items + data/overrides
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
cargo run --release -p wf-cli -- sweep [--previous old-report.json]
cargo run --release -p wf-cli -- golden
pnpm build:wasm && pnpm dev      # web app on http://localhost:5173
```

Requires Rust with `wasm32-unknown-unknown` and `wasm-pack`. After changing `crates/`, run
`pnpm build:wasm` and `pnpm optimize` (best builds go stale when the engine or data changes;
the browser warns when the data version differs).
