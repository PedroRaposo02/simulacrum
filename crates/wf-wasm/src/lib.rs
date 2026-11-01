use serde::Serialize;
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

    /// Unmodded best mode of every weapon vs a target, for the weapon browser.
    pub fn rank(&self, target_json: &str) -> String {
        let target: Target = serde_json::from_str(target_json).unwrap_or_default();
        let mut rows = Vec::with_capacity(self.data.weapons.len());
        for w in &self.data.weapons {
            let build = Build { weapon: w.id.clone(), ..Default::default() };
            let row = |mode: String, b: f64, s: f64, p: f64, c: Coverage, failed: Option<String>| RankRow {
                weapon_id: w.id.clone(),
                name: w.name.clone(),
                slot: w.slot,
                class: w.class,
                mode,
                burst_dps: b,
                sustained_dps: s,
                per_shot: p,
                coverage: c,
                failed,
            };
            match compute(&self.data, &build, &target) {
                Ok(r) => match r.modes.iter().max_by(|a, b| a.burst_dps.total_cmp(&b.burst_dps)) {
                    Some(m) => rows.push(row(m.mode.clone(), m.burst_dps, m.sustained_dps, m.per_shot, m.coverage, None)),
                    None => rows.push(row(String::new(), 0.0, 0.0, 0.0, Coverage::Unsupported, r.failed_modes.first().map(|f| f.error.message.clone()))),
                },
                Err(e) => rows.push(row(String::new(), 0.0, 0.0, 0.0, Coverage::Unsupported, Some(e.message))),
            }
        }
        to_json(&rows)
    }
}
