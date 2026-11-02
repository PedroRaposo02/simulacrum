use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wf_opt::{optimize, rank_rivens, riven_modifiers, OptimizeOptions, RivenPick};
use wasm_bindgen::prelude::*;
use wf_calc::{compute, Build, Target};
use wf_data::{Coverage, GameData};

#[wasm_bindgen]
pub struct Engine {
    data: GameData,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RankRow {
    weapon_id: String,
    name: String,
    slot: wf_data::Slot,
    class: wf_data::WeaponClass,
    mode: String,
    burst_dps: f64,
    sustained_dps: f64,
    group_dps: f64,
    group_sustained_dps: f64,
    per_shot: f64,
    coverage: Coverage,
    failed: Option<String>,
}

fn to_json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|e| format!("{{\"error\":{{\"code\":\"internal\",\"message\":\"{e}\"}}}}"))
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(gamedata_json: &str) -> Result<Engine, JsError> {
        Ok(Engine { data: GameData::from_json(gamedata_json).map_err(|e| JsError::new(&e.to_string()))? })
    }

    pub fn version(&self) -> String {
        self.data.version.clone()
    }

    /// Returns `{"ok": BuildResult}` or `{"error": CalcError}` as JSON.
    pub fn compute(&self, build_json: &str, target_json: &str) -> String {
        let parsed: Result<(Build, Target), String> = (|| {
            Ok((
                serde_json::from_str(build_json).map_err(|e| format!("build: {e}"))?,
                serde_json::from_str(target_json).map_err(|e| format!("target: {e}"))?,
            ))
        })();
        match parsed {
            Err(m) => to_json(&serde_json::json!({"error": {"code": "invalidValue", "message": m}})),
            Ok((b, t)) => match compute(&self.data, &b, &t) {
                Ok(r) => to_json(&serde_json::json!({ "ok": r })),
                Err(e) => to_json(&serde_json::json!({ "error": e })),
            },
        }
    }

    /// Ids of mods that fit a weapon, as a JSON array.
    #[wasm_bindgen(js_name = compatibleMods)]
    pub fn compatible_mods(&self, weapon: &str) -> String {
        let Some(w) = self.data.weapon(weapon) else { return "[]".into() };
        to_json(&self.data.mods.iter().filter(|m| m.fits(w)).map(|m| &m.id).collect::<Vec<_>>())
    }

    /// Rank every weapon vs a target. `base_build_json` carries shared buffs and conditions;
    /// `per_weapon_json` maps weapon id -> {mods, arcane, riven, modeIndex} (e.g. precomputed best
    /// builds). Weapons missing from the map are ranked unmodded on their best mode.
    pub fn rank(&self, target_json: &str, base_build_json: &str, per_weapon_json: &str) -> String {
        let target: Target = serde_json::from_str(target_json).unwrap_or_default();
        let base: Build = serde_json::from_str(base_build_json).unwrap_or_default();
        let per: HashMap<String, WeaponBuild> = serde_json::from_str(per_weapon_json).unwrap_or_default();
        let mut rows = Vec::with_capacity(self.data.weapons.len());
        for w in &self.data.weapons {
            let row = |mode: String, b: f64, s: f64, g: (f64, f64), p: f64, c: Coverage, failed: Option<String>| RankRow {
                weapon_id: w.id.clone(),
                name: w.name.clone(),
                slot: w.slot,
                class: w.class,
                mode,
                burst_dps: b,
                sustained_dps: s,
                group_dps: g.0,
                group_sustained_dps: g.1,
                per_shot: p,
                coverage: c,
                failed,
            };
            let wb = per.get(&w.id);
            let build = Build {
                weapon: w.id.clone(),
                mods: wb.map(|b| b.mods.clone()).unwrap_or_default(),
                arcane: wb.and_then(|b| b.arcane.clone()),
                riven: wb.map(|b| riven_modifiers(&self.data, &b.riven)).unwrap_or_default(),
                evolutions: wb.map(|b| b.evolutions.clone()).unwrap_or_default(),
                progenitor: wb.and_then(|b| b.progenitor),
                ..base.clone()
            };
            match compute(&self.data, &build, &target) {
                Ok(r) => {
                    let chosen = match wb.and_then(|b| b.mode_index) {
                        Some(i) => r.modes.iter().find(|m| m.mode_index == i),
                        None => {
                            let headline = |m: &&wf_calc::ModeResult| w.modes[m.mode_index].is_headline();
                            r.modes
                                .iter()
                                .filter(headline)
                                .max_by(|a, b| a.burst_dps.total_cmp(&b.burst_dps))
                                .or_else(|| r.modes.iter().max_by(|a, b| a.burst_dps.total_cmp(&b.burst_dps)))
                        }
                    };
                    match chosen {
                        Some(m) => rows.push(row(
                            m.mode.clone(),
                            m.burst_dps,
                            m.sustained_dps,
                            (m.group_dps, m.group_sustained_dps),
                            m.per_shot,
                            m.coverage,
                            None,
                        )),
                        None => rows.push(row(
                            String::new(),
                            0.0,
                            0.0,
                            (0.0, 0.0),
                            0.0,
                            Coverage::Unsupported,
                            r.failed_modes.first().map(|f| f.error.message.clone()),
                        )),
                    }
                }
                Err(e) => rows.push(row(String::new(), 0.0, 0.0, (0.0, 0.0), 0.0, Coverage::Unsupported, Some(e.message))),
            }
        }
        to_json(&rows)
    }

    /// Every riven roll for a weapon ranked best to worst. Returns `{"ok": RivenRanking}` or `{"error": …}`.
    #[wasm_bindgen(js_name = rankRivens)]
    pub fn rank_rivens(&self, weapon: &str, base_build_json: &str, target_json: &str, options_json: &str) -> String {
        let base: Build = serde_json::from_str(base_build_json).unwrap_or_default();
        let target: Target = serde_json::from_str(target_json).unwrap_or_default();
        let opts: OptimizeOptions = serde_json::from_str(options_json).unwrap_or_default();
        match rank_rivens(&self.data, weapon, &base, &target, &opts) {
            Ok(r) => to_json(&serde_json::json!({ "ok": r })),
            Err(e) => to_json(&serde_json::json!({ "error": e })),
        }
    }

    /// Theoretical best build for one weapon. Returns `{"ok": OptimizeResult}` or `{"error": CalcError}`.
    pub fn optimize(&self, weapon: &str, base_build_json: &str, target_json: &str, options_json: &str) -> String {
        let base: Build = serde_json::from_str(base_build_json).unwrap_or_default();
        let target: Target = serde_json::from_str(target_json).unwrap_or_default();
        let opts: OptimizeOptions = serde_json::from_str(options_json).unwrap_or_default();
        match optimize(&self.data, weapon, &base, &target, &opts) {
            Ok(r) => to_json(&serde_json::json!({ "ok": r })),
            Err(e) => to_json(&serde_json::json!({ "error": e })),
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct WeaponBuild {
    mods: Vec<String>,
    arcane: Option<String>,
    riven: Vec<RivenPick>,
    mode_index: Option<usize>,
    evolutions: Vec<String>,
    progenitor: Option<wf_data::DamageType>,
}
