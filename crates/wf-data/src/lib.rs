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
    /// Melee heavy attacks multiply by the combo multiplier they consume.
    pub combo_scaling: bool,
}

impl Default for HitRules {
    fn default() -> Self {
        Self { can_headshot: true, receives_multishot: true, gun_co: None, combo_scaling: false }
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
    /// False for side attacks (melee slams, throws, ranged specials) whose rate isn't the weapon's
    /// attack speed; such modes aren't picked as the weapon's headline number.
    #[serde(default = "yes", skip_serializing_if = "Clone::clone")]
    pub headline: bool,
}

fn yes() -> bool {
    true
}

impl AttackMode {
    /// Modes that can headline a weapon's DPS. Heavy attacks consume combo, so a sustained
    /// rate at full combo is impossible; they stay computable but aren't picked by default.
    pub fn is_headline(&self) -> bool {
        self.headline && !self.components.iter().any(|c| c.rules.combo_scaling)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Weapon {
    pub id: String,
    pub name: String,
    pub slot: Slot,
    pub class: WeaponClass,
    pub family: String,
    /// Finer type from the source (e.g. "Nikana", "Heavy Blade") used by class-restricted mods.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtype: Option<String>,
    /// Which mod pool the weapon takes (companion weapons borrow rifle/shotgun/pistol/melee mods).
    pub mod_pool: ModPool,
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
    /// Ability damage buffs (Roar, Eclipse): one additive pool, applied as a final multiplier.
    AbilityDamage,
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

/// Modifiers whose value repeats per counted thing (Condition Overload, Blood Rush, Galvanized Shot).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PerCount {
    StatusType,
    ComboMultiplier,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub per: Option<PerCount>,
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
    /// Only fits weapons whose primary attack uses this trigger (Cannonade mods: semi-auto).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_trigger: Option<Trigger>,
    /// While equipped, fire rate bonuses from every source are ignored.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub locks_fire_rate: bool,
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

/// Riven types; each weapon maps to one through its mod pool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RivenType {
    Rifle,
    Shotgun,
    Pistol,
    ArchGun,
    Melee,
}

impl RivenType {
    pub fn for_pool(pool: ModPool) -> RivenType {
        match pool {
            ModPool::Primary | ModPool::Companion => RivenType::Rifle,
            ModPool::Shotgun => RivenType::Shotgun,
            ModPool::Secondary => RivenType::Pistol,
            ModPool::ArchGun => RivenType::ArchGun,
            ModPool::Melee => RivenType::Melee,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RivenStatDef {
    pub key: String,
    pub label: String,
    /// None for stats with no damage effect (zoom, recoil...): valid as harmless negatives.
    pub stat: Option<Stat>,
    /// Base value (fraction) per riven type, before disposition and layout. Missing = can't roll.
    pub base: BTreeMap<RivenType, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RivenLayout {
    pub positives: u8,
    pub negative: bool,
    pub positive_mult: f64,
    pub negative_mult: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RivenTable {
    pub disposition: f64,
    pub roll_min: f64,
    pub roll_max: f64,
    pub layouts: Vec<RivenLayout>,
    pub stats: Vec<RivenStatDef>,
}

impl RivenTable {
    pub fn layout(&self, positives: usize, negative: bool) -> Option<&RivenLayout> {
        self.layouts.iter().find(|l| l.positives as usize == positives && l.negative == negative)
    }

    /// (min, max) of a stat's rolled value for this riven type and layout; negatives are returned as negative numbers.
    pub fn range(&self, key: &str, ty: RivenType, layout: &RivenLayout, negative: bool) -> Option<(f64, f64)> {
        let def = self.stats.iter().find(|s| s.key == key)?;
        let base = *def.base.get(&ty)?;
        let mult = if negative { -layout.negative_mult } else { layout.positive_mult };
        let v = base * self.disposition * mult;
        let (a, b) = (v * self.roll_min, v * self.roll_max);
        Some((a.min(b), a.max(b)))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuffDef {
    pub id: String,
    pub name: String,
    pub source: String,
    /// Values are at 100% ability strength when true.
    pub scales_with_strength: bool,
    pub modifiers: Vec<Modifier>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub riven: Option<RivenTable>,
    #[serde(default)]
    pub buffs: Vec<BuffDef>,
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
        if self.pool != w.mod_pool {
            return false;
        }
        if let Some(t) = self.requires_trigger {
            if w.modes.first().map(|m| m.trigger) != Some(t) {
                return false;
            }
        }
        match self.compat.as_deref() {
            None => true,
            Some("sniper") => w.class == WeaponClass::Sniper,
            Some("bow") => w.class == WeaponClass::Bow,
            Some("assault rifle") => w.class == WeaponClass::Rifle,
            Some(name) => {
                w.name.to_lowercase() == name
                    || w.family.to_lowercase() == name
                    || w.subtype.as_deref().is_some_and(|t| t.to_lowercase() == name)
            }
        }
    }

    /// True when the mod changes something the damage engine models.
    pub fn affects_damage(&self) -> bool {
        self.modifiers.iter().any(|m| !matches!(m.stat, Stat::StatusDuration))
    }
}
