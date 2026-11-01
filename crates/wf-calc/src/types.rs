use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use wf_data::{Coverage, DamageType, EnemyProfile, Modifier};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Conditions {
    /// 0..1 uptime applied to conditional modifiers (on kill, on headshot, aiming...).
    pub conditional_uptime: f64,
    /// Share of hits that land on a headshot / weak point (only where allowed).
    pub headshot_share: f64,
    /// Distinct status types on the target, for "per status type" effects.
    pub status_types: f64,
    /// Melee combo multiplier during light attacks (1 = no combo, 12 = max). Tennokai heavies use it too.
    pub combo_multiplier: f64,
    /// Combo multiplier a regular heavy attack consumes (practical max ~5x with Galvanized Reflex).
    pub heavy_combo_multiplier: f64,
    /// Whether on-headshot / on-weak-point-kill effects are active (Deadhead, Galvanized Crosshairs).
    pub headshot_effects: bool,
    /// Set by the engine for companion weapons: their AI doesn't aim or reliably headshot.
    #[serde(skip)]
    pub companion: bool,
}

impl Default for Conditions {
    fn default() -> Self {
        Self {
            conditional_uptime: 1.0,
            headshot_share: 0.0,
            status_types: 4.0,
            combo_multiplier: 12.0,
            heavy_combo_multiplier: 5.0,
            headshot_effects: true,
            companion: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Build {
    pub weapon: String,
    /// Mod names or ids, in slot order (element combination depends on it).
    pub mods: Vec<String>,
    pub arcane: Option<String>,
    pub riven: Vec<Modifier>,
    pub buffs: Vec<Modifier>,
    /// Incarnon evolution names (one per tier).
    pub evolutions: Vec<String>,
    pub conditions: Conditions,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Target {
    /// Preset id from gamedata, or None for "raw" numbers (no enemy).
    pub enemy: Option<String>,
    /// Inline profile; takes precedence over `enemy`.
    pub profile: Option<EnemyProfile>,
    /// External armor strip 0..1 (abilities, shattering impact...).
    pub armor_strip: f64,
    /// Corrosive Projection auras in the squad (0-4), -18% armor each at max rank.
    pub corrosive_projection: f64,
    /// Outsourced status from allies or abilities. The engine uses the higher of this and
    /// the stacks the weapon keeps up by itself.
    pub viral_stacks: Option<f64>,
    pub corrosive_stacks: Option<f64>,
    /// Heat proc kept on the target externally (halves armor).
    pub heat_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Explain {
    pub label: String,
    pub value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Explain>,
}

impl Explain {
    pub fn new(label: impl Into<String>, value: f64) -> Self {
        Self { label: label.into(), value, detail: None, children: vec![] }
    }
    pub fn detail(mut self, d: impl Into<String>) -> Self {
        self.detail = Some(d.into());
        self
    }
    pub fn child(mut self, c: Explain) -> Self {
        self.children.push(c);
        self
    }
    pub fn with(mut self, cs: Vec<Explain>) -> Self {
        self.children.extend(cs);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentResult {
    pub name: String,
    pub damage: BTreeMap<DamageType, f64>,
    pub per_projectile_raw: f64,
    pub per_projectile_target: f64,
    pub projectiles: f64,
    pub crit_chance: f64,
    pub crit_mult: f64,
    pub status_chance: f64,
    pub explain: Explain,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeResult {
    pub mode: String,
    pub mode_index: usize,
    pub coverage: Coverage,
    pub approximations: Vec<String>,
    pub fire_rate: f64,
    pub magazine: Option<u32>,
    pub reload_s: f64,
    pub per_shot_raw: f64,
    pub per_shot: f64,
    pub burst_dps_raw: f64,
    pub burst_dps: f64,
    pub sustained_dps: f64,
    pub per_charge: Option<f64>,
    pub status_dps: f64,
    pub procs_per_s: BTreeMap<DamageType, f64>,
    pub viral_stacks: f64,
    pub corrosive_stacks: f64,
    /// Melee: modded attack speed (weapon base x (1 + bonus)) and range in meters.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attack_speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range_m: Option<f64>,
    /// Combo multiplier used for this mode's hits (melee).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub combo_multiplier: Option<f64>,
    pub components: Vec<ComponentResult>,
    pub explain: Explain,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub weapon: String,
    pub weapon_id: String,
    pub target: String,
    pub modes: Vec<ModeResult>,
    pub failed_modes: Vec<ModeFailure>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeFailure {
    pub mode: String,
    pub mode_index: usize,
    pub error: CalcError,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    UnknownWeapon,
    UnknownMod,
    UnknownArcane,
    UnknownEvolution,
    UnknownEnemy,
    IncompatibleMod,
    DuplicateMod,
    ExclusiveMods,
    UnknownMechanic,
    MissingField,
    InvalidValue,
    NonFinite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalcError {
    pub code: ErrorCode,
    pub message: String,
}

impl CalcError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

impl std::fmt::Display for CalcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for CalcError {}
