use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DamageType {
    Impact,
    Puncture,
    Slash,
    Heat,
    Cold,
    Electricity,
    Toxin,
    Blast,
    Radiation,
    Gas,
    Magnetic,
    Viral,
    Corrosive,
    Void,
    Tau,
    True,
}

impl DamageType {
    pub const ALL: [DamageType; 16] = [
        Self::Impact, Self::Puncture, Self::Slash, Self::Heat, Self::Cold, Self::Electricity,
        Self::Toxin, Self::Blast, Self::Radiation, Self::Gas, Self::Magnetic, Self::Viral,
        Self::Corrosive, Self::Void, Self::Tau, Self::True,
    ];

    pub fn is_physical(self) -> bool {
        matches!(self, Self::Impact | Self::Puncture | Self::Slash)
    }

    pub fn is_primary_element(self) -> bool {
        matches!(self, Self::Heat | Self::Cold | Self::Electricity | Self::Toxin)
    }

    pub fn combine(a: DamageType, b: DamageType) -> Option<DamageType> {
        use DamageType::*;
        let pair = if a <= b { (a, b) } else { (b, a) };
        Some(match pair {
            (Heat, Cold) => Blast,
            (Electricity, Toxin) => Corrosive,
            (Heat, Toxin) => Gas,
            (Cold, Electricity) => Magnetic,
            (Cold, Toxin) => Viral,
            (Heat, Electricity) => Radiation,
            _ => return None,
        })
    }

    pub fn components(self) -> Option<(DamageType, DamageType)> {
        use DamageType::*;
        Some(match self {
            Blast => (Heat, Cold),
            Corrosive => (Electricity, Toxin),
            Gas => (Heat, Toxin),
            Magnetic => (Cold, Electricity),
            Viral => (Cold, Toxin),
            Radiation => (Heat, Electricity),
            _ => return None,
        })
    }
}

pub type DamageMap = BTreeMap<DamageType, f64>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Slot {
    Primary,
    Secondary,
    Melee,
    ArchGun,
    Companion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WeaponClass {
    Rifle,
    Shotgun,
    Sniper,
    Bow,
    Launcher,
    Pistol,
    SecondaryShotgun,
    Thrown,
    ArchGun,
    Companion,
    Melee,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Trigger {
    Semi,
    Auto,
    Burst,
    Charge,
    Held,
    Duplex,
    Active,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HitKind {
    Direct,
    Radial,
    Beam,
    DotCloud,
    Thrown,
    Melee,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Faction {
    Grineer,
    Corpus,
    Infested,
    Corrupted,
    Murmur,
    Sentient,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Coverage {
    Verified,
    Computed,
    Approximate,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Falloff {
    pub start_m: f64,
    pub end_m: f64,
    pub reduction: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GunCoMode {
    Adds,
    Multiplies,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GunCo {
    pub factor: f64,
    pub mode: GunCoMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HitRules {
    pub can_headshot: bool,
    pub receives_multishot: bool,
    pub gun_co: Option<GunCo>,
}

impl Default for HitRules {
    fn default() -> Self {
        Self { can_headshot: true, receives_multishot: true, gun_co: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitComponent {
    pub name: String,
    pub kind: HitKind,
    pub damage: DamageMap,
    pub crit_chance: f64,
    pub crit_mult: f64,
    pub status_chance: f64,
    pub multishot: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub falloff: Option<Falloff>,
    #[serde(default)]
    pub rules: HitRules,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum AmmoPool {
    Magazine,
    Incarnon { rounds: Option<u32>, recharge_s: Option<f64> },
    Battery,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttackMode {
    pub name: String,
    pub trigger: Trigger,
    pub fire_rate: f64,
    pub magazine: Option<u32>,
    pub reload_s: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub charge_time_s: Option<f64>,
    pub ammo_pool: AmmoPool,
    pub components: Vec<HitComponent>,
    pub coverage: Coverage,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Weapon {
    pub id: String,
    pub name: String,
    pub slot: Slot,
    pub class: WeaponClass,
    pub family: String,
    pub modes: Vec<AttackMode>,
    #[serde(default)]
    pub innate: Vec<Modifier>,
    #[serde(default)]
    pub mechanic_tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default)]
    pub sources: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "of")]
pub enum Stat {
    BaseDamage,
    Physical(DamageType),
    Element(DamageType),
    Multishot,
    CritChance,
    CritChanceFlat,
    CritDamage,
    CritDamageFlat,
    StatusChance,
    FireRate,
    Magazine,
    ReloadSpeed,
    FactionDamage(Faction),
    HeadshotDamage,
    StatusDuration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComponentFilter {
    All,
    DirectOnly,
    RadialOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Condition {
    Always,
    OnKill,
    OnHeadshot,
    OnHeadshotKill,
    Aiming,
    OnReload,
    OnStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Modifier {
    pub source: String,
    pub stat: Stat,
    pub value: f64,
    #[serde(default = "one")]
    pub max_stacks: u8,
    #[serde(default = "all_components")]
    pub applies_to: ComponentFilter,
    #[serde(default = "always")]
    pub condition: Condition,
}

fn one() -> u8 { 1 }
fn all_components() -> ComponentFilter { ComponentFilter::All }
fn always() -> Condition { Condition::Always }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModPool {
    Primary,
    Shotgun,
    Secondary,
    Melee,
    ArchGun,
    Companion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mod {
    pub id: String,
    pub name: String,
    pub pool: ModPool,
    /// Narrows the pool: a class ("sniper", "bow", "rifle") or a weapon name for augments.
    pub compat: Option<String>,
    pub polarity: String,
    pub base_drain: i32,
    pub max_rank: u8,
    pub is_exilus: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclusive_group: Option<String>,
    pub modifiers: Vec<Modifier>,
    /// Stat lines the ingest parser could not turn into modifiers.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unparsed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Arcane {
    pub id: String,
    pub name: String,
    pub slot: String,
    pub behaviour: Option<String>,
    #[serde(default)]
    pub modifiers: Vec<Modifier>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnemyProfile {
    pub id: String,
    pub name: String,
    pub faction: Faction,
    pub armor: f64,
    #[serde(default)]
    pub shields: bool,
    #[serde(default)]
    pub is_boss: bool,
    /// Multipliers by damage type against this health class, e.g. {"slash": 1.25}.
    #[serde(default)]
    pub health_modifiers: BTreeMap<DamageType, f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameData {
    pub version: String,
    pub generated_at: String,
    pub sources: BTreeMap<String, String>,
    pub weapons: Vec<Weapon>,
    pub mods: Vec<Mod>,
    #[serde(default)]
    pub arcanes: Vec<Arcane>,
    #[serde(default)]
    pub enemies: Vec<EnemyProfile>,
}

impl GameData {
    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }

    pub fn weapon(&self, key: &str) -> Option<&Weapon> {
        let k = key.to_lowercase();
        self.weapons
            .iter()
            .find(|w| w.id == key || w.name.to_lowercase() == k)
    }

    pub fn find_mod(&self, key: &str) -> Option<&Mod> {
        let k = key.to_lowercase();
        self.mods.iter().find(|m| m.id == key || m.name.to_lowercase() == k)
    }

    pub fn find_arcane(&self, key: &str) -> Option<&Arcane> {
        let k = key.to_lowercase();
        self.arcanes.iter().find(|a| a.id == key || a.name.to_lowercase() == k)
    }

    pub fn enemy(&self, key: &str) -> Option<&EnemyProfile> {
        self.enemies.iter().find(|e| e.id == key)
    }
}

impl Mod {
    pub fn fits(&self, w: &Weapon) -> bool {
        let pool_ok = match self.pool {
            ModPool::Primary => w.slot == Slot::Primary && w.class != WeaponClass::Shotgun,
            ModPool::Shotgun => w.class == WeaponClass::Shotgun,
            ModPool::Secondary => w.slot == Slot::Secondary,
            ModPool::Melee => w.slot == Slot::Melee,
            ModPool::ArchGun => w.slot == Slot::ArchGun,
            ModPool::Companion => w.slot == Slot::Companion,
        };
        if !pool_ok {
            return false;
        }
        match self.compat.as_deref() {
            None => true,
            Some("sniper") => w.class == WeaponClass::Sniper,
            Some("bow") => w.class == WeaponClass::Bow,
            Some("assault rifle") => w.class == WeaponClass::Rifle,
            Some(name) => w.name.to_lowercase() == name || w.family.to_lowercase() == name,
        }
    }
}
