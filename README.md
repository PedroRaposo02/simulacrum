# Simulacrum — Warframe build calculator

Implementation of `Warframe Build Calculator — App Development & Calculation Plan.md`, phase 1 (guns).

## Layout

```
crates/wf-data   data model (weapons, attack modes, hit components, modifiers)
crates/wf-calc   damage engine, behaviours (Enervate sim), sweep
crates/wf-cli    `wfcalc explain | sweep | golden`
crates/wf-wasm   wasm-bindgen wrapper used by the web app
apps/web         React + Vite + Tailwind UI (weapon browser, build editor)
tools/ingest     builds data/gamedata.json from @wfcd/items + data/overrides
data/overrides   hand-kept fixes: mod exclusivity, arcane behaviours, Incarnon ammo, enemy presets
data/golden      regression vectors
```

## Commands

```sh
pnpm install
pnpm ingest                      # -> data/gamedata.json (+ apps/web/public copy)
cargo test -p wf-calc            # formula, property and behaviour tests
cargo run --release -p wf-cli -- explain Laetum --mods "Hornet Strike,Barrel Diffusion" --enemy sp-grineer
cargo run --release -p wf-cli -- sweep [--previous old-report.json]
cargo run --release -p wf-cli -- golden
pnpm build:wasm && pnpm dev      # web app on http://localhost:5173
```

Requires Rust with `wasm32-unknown-unknown` and `wasm-pack`.
