use crate::behaviours;
use crate::elements::{combine, ElementInput};
use crate::types::*;
use std::collections::BTreeMap;
use wf_data::*;

const ARMOR_CAP: f64 = 2700.0;
const MAX_DR: f64 = 0.9;
const STATUS_DURATION_S: f64 = 6.0;
/// Armor removed per Corrosive Projection aura at max rank.
const CORROSIVE_PROJECTION: f64 = 0.18;
/// Max progenitor bonus on Kuva / Tenet weapons: 60% of base damage as an innate element.
pub const PROGENITOR_BONUS: f64 = 0.6;
/// Elements a Kuva Lich or Sister of Parvos can carry.
pub const PROGENITOR_ELEMENTS: [DamageType; 7] = [
    DamageType::Impact,
    DamageType::Heat,
    DamageType::Cold,
    DamageType::Electricity,
    DamageType::Toxin,
    DamageType::Magnetic,
    DamageType::Radiation,
];

/// DoT statuses: (type, fraction of modded base damage per tick, ticks per proc).
/// Approximate values from the wiki's status table; kept here until moved to overrides.
/// Status types that deal damage (wiki, Update 36+): Slash 35% of modded base per tick, Heat/Toxin/
/// Electricity/Gas 50% (times their own elemental mod bonus), Blast 30% per proc.
const DAMAGING_STATUS: [DamageType; 6] =
    [DamageType::Slash, DamageType::Heat, DamageType::Toxin, DamageType::Gas, DamageType::Electricity, DamageType::Blast];
/// Group fights: enemies stand within this radius of the main target; an effect of radius r reaches
/// group_size x r / GROUP_SPREAD_M of them (at least 1).
const GROUP_SPREAD_M: f64 = 5.0;
const BLAST_FUSE_S: f64 = 1.5;
const BLAST_STACKS: f64 = 10.0;
const GAS_MAX_STACKS: f64 = 10.0;
const GAS_RADIUS_M: f64 = 4.5;
const ELECTRICITY_RADIUS_M: f64 = 3.0;
const BLAST_RADIUS_M: f64 = 5.0;
const INFLUENCE_CHANCE: f64 = 0.2;
const INFLUENCE_DURATION_S: f64 = 18.0;
/// Punch through: about one enemy per meter, and at most 2 more enemies lined up behind the target.
const PIERCE_MAX_EXTRA: f64 = 2.0;
const CONTAGIOUS_BOND_RADIUS_M: f64 = 9.0;
const CONTAGIOUS_BOND_MAX_STACKS: f64 = 100.0;
/// Melee combo: 20 points per +1x; Initial Combo comes back at 40 points per second.
const COMBO_POINTS_PER_TIER: f64 = 20.0;
const INITIAL_COMBO_REGEN: f64 = 40.0;
const HEAVY_EFFICIENCY_CAP: f64 = 0.9;
/// Tennokai: 15% chance per melee hit to open a window (wiki).
const TENNOKAI_CHANCE: f64 = 0.15;
/// Enemies don't arrive faster than one group every this many seconds, whatever the damage.
const GROUP_RESPAWN_S: f64 = 3.0;
/// Ammo efficiency is capped at 75%; infinite ammo only comes from specific effects (Arcane Pistoleer…).
const AMMO_EFFICIENCY_CAP: f64 = 0.75;

/// Additive pools collected from every modifier source.
#[derive(Default, Debug)]
struct Pools {
    base_damage: f64,
    physical: BTreeMap<DamageType, f64>,
    elements: Vec<(DamageType, f64, String)>,
    multishot: f64,
    crit_chance: f64,
    crit_chance_flat: f64,
    status_chance_flat: f64,
    base_flat: f64,
    crit_chance_base: f64,
    crit_mult_base: f64,
    status_chance_base: f64,
    multishot_damage: f64,
    /// Per-status-type damage (Galvanized Shot/Aptitude, Condition Overload, Fatal Affliction):
    /// added to base damage or applied as its own multiplier depending on the attack (GunCO).
    gunco: f64,
    /// (ratio, cap) links: status from crit, crit from status.
    status_from_crit: Vec<(f64, f64)>,
    crit_from_status: Vec<(f64, f64)>,
    /// Modifiers that depend on the final crit chance: (threshold, stat, value, source).
    below_crit: Vec<(f64, Stat, f64, String)>,
    crit_damage: f64,
    crit_damage_flat: f64,
    status_chance: f64,
    fire_rate: f64,
    magazine: f64,
    reload: f64,
    faction: BTreeMap<Faction, f64>,
    faction_all: f64,
    headshot: f64,
    status_duration: f64,
    ability: f64,
    range: f64,
    wind_up: f64,
    final_damage: f64,
    crit_mult_mult: f64,
    status_damage: f64,
    punch_through: f64,
    initial_combo: f64,
    heavy_eff: f64,
    ammo_eff: f64,
    head_crit: f64,
    /// (chance per headshot, seconds) of infinite ammo.
    infinite_ammo: Vec<(f64, f64)>,
    sources: Vec<(String, Stat, f64)>,
    /// Numbers only: no source names (Conditions::calc_only).
    quiet: bool,
}

impl Pools {
    fn new(quiet: bool) -> Self {
        Pools { quiet, ..Default::default() }
    }

    fn source(&self, m: &Modifier) -> String {
        if self.quiet { String::new() } else { m.source.clone() }
    }

    fn add(&mut self, m: &Modifier, scale: f64) {
        let v = m.value * scale;
        if m.condition == Condition::CritChanceBelow {
            self.below_crit.push((m.threshold.unwrap_or(0.0), m.stat, m.value, self.source(m)));
            return;
        }
        if m.per == Some(PerCount::StatusType) && m.stat == Stat::BaseDamage {
            self.gunco += v;
            if !self.quiet {
                self.sources.push((m.source.clone(), m.stat, v));
            }
            return;
        }
        match m.stat {
            Stat::BaseDamage => self.base_damage += v,
            Stat::Physical(t) => *self.physical.entry(t).or_default() += v,
            Stat::Element(t) => self.elements.push((t, v, self.source(m))),
            Stat::Multishot => self.multishot += v,
            Stat::CritChance => self.crit_chance += v,
            Stat::CritChanceFlat => self.crit_chance_flat += v,
            Stat::StatusChanceFlat => self.status_chance_flat += v,
            Stat::BaseDamageFlat => self.base_flat += v,
            Stat::CritChanceBase => self.crit_chance_base += v,
            Stat::CritMultBase => self.crit_mult_base += v,
            Stat::StatusChanceBase => self.status_chance_base += v,
            Stat::MultishotDamage => self.multishot_damage += v,
            Stat::StatusChanceBaseFromCrit => self.status_from_crit.push((v, m.threshold.unwrap_or(f64::INFINITY))),
            Stat::CritChanceBaseFromStatus => self.crit_from_status.push((v, m.threshold.unwrap_or(f64::INFINITY))),
            Stat::CritDamage => self.crit_damage += v,
            Stat::CritDamageFlat => self.crit_damage_flat += v,
            Stat::StatusChance => self.status_chance += v,
            Stat::FireRate => self.fire_rate += v,
            Stat::Magazine => self.magazine += v,
            Stat::ReloadSpeed => self.reload += v,
            Stat::FactionDamage(f) => *self.faction.entry(f).or_default() += v,
            Stat::FactionDamageAll => self.faction_all += v,
            Stat::HeadshotDamage => self.headshot += v,
            Stat::StatusDuration => self.status_duration += v,
            Stat::AbilityDamage => self.ability += v,
            Stat::Range => self.range += v,
            Stat::WindUpSpeed => self.wind_up += v,
            Stat::FinalDamage => self.final_damage += v,
            Stat::CritMultMultiplier => self.crit_mult_mult += v,
            Stat::StatusDamage => self.status_damage += v,
            Stat::PunchThrough => self.punch_through += v,
            Stat::InitialCombo => self.initial_combo += v,
            Stat::HeavyEfficiency => self.heavy_eff += v,
            Stat::AmmoEfficiency => self.ammo_eff += v,
            Stat::HeadshotCritChance => self.head_crit += v,
            Stat::InfiniteAmmoOnHeadshot => self.infinite_ammo.push((v, m.threshold.unwrap_or(0.0))),
        }
        if !self.quiet {
            self.sources.push((m.source.clone(), m.stat, v));
        }
    }

    fn sources_for(&self, pred: impl Fn(Stat) -> bool) -> Vec<Explain> {
        if self.quiet {
            return Vec::new();
        }
        self.sources
            .iter()
            .filter(|(_, s, _)| pred(*s))
            .map(|(src, _, v)| Explain::new(src.clone(), *v))
            .collect()
    }
}

/// A build with every name looked up. The optimizer builds these directly to skip lookups.
pub struct Resolved<'a> {
    pub weapon: &'a Weapon,
    pub mods: Vec<&'a Mod>,
    pub arcane: Option<&'a Arcane>,
    pub evolutions: Vec<&'a Evolution>,
    pub enemy: Option<EnemyProfile>,
    pub warnings: Vec<String>,
}

fn form_ok(forms: EvolutionForms, mode: &AttackMode) -> bool {
    match forms {
        EvolutionForms::Both => true,
        EvolutionForms::Incarnon => mode.incarnon_form,
        EvolutionForms::Normal => !mode.incarnon_form,
    }
}

pub fn resolve_enemy(data: &GameData, target: &Target) -> Result<Option<EnemyProfile>, CalcError> {
    Ok(match (&target.profile, &target.enemy) {
        (Some(p), _) => Some(p.clone()),
        (None, Some(id)) => Some(
            data.enemy(id)
                .cloned()
                .ok_or_else(|| CalcError::new(ErrorCode::UnknownEnemy, format!("no enemy preset '{id}'")))?,
        ),
        _ => None,
    })
}

fn resolve<'a>(data: &'a GameData, build: &Build, target: &Target) -> Result<Resolved<'a>, CalcError> {
    let weapon = data
        .weapon(&build.weapon)
        .ok_or_else(|| CalcError::new(ErrorCode::UnknownWeapon, format!("no weapon '{}'", build.weapon)))?;
    let mut mods = Vec::new();
    let mut warnings = Vec::new();
    for key in &build.mods {
        let m = data
            .find_mod(key)
            .ok_or_else(|| CalcError::new(ErrorCode::UnknownMod, format!("no mod '{key}'")))?;
        if !m.fits(weapon) {
            return Err(CalcError::new(
                ErrorCode::IncompatibleMod,
                format!("{} does not fit {}", m.name, weapon.name),
            ));
        }
        if mods.iter().any(|x: &&Mod| x.id == m.id) {
            return Err(CalcError::new(ErrorCode::DuplicateMod, format!("{} equipped twice", m.name)));
        }
        if let Some(g) = &m.exclusive_group {
            if let Some(other) = mods.iter().find(|x| x.exclusive_group.as_ref() == Some(g)) {
                return Err(CalcError::new(
                    ErrorCode::ExclusiveMods,
                    format!("{} and {} can't be equipped together", other.name, m.name),
                ));
            }
        }
        if !m.unparsed.is_empty() {
            warnings.push(format!("{}: ignored effect(s) {:?}", m.name, m.unparsed));
        }
        mods.push(m);
    }
    let arcane = match &build.arcane {
        Some(a) => Some(
            data.find_arcane(a)
                .ok_or_else(|| CalcError::new(ErrorCode::UnknownArcane, format!("no arcane '{a}'")))?,
        ),
        None => None,
    };
    let mut evolutions = Vec::new();
    for name in &build.evolutions {
        let e = weapon.evolution(name).ok_or_else(|| {
            CalcError::new(ErrorCode::UnknownEvolution, format!("{} has no evolution '{name}'", weapon.name))
        })?;
        evolutions.push(e);
    }
    let enemy = resolve_enemy(data, target)?;
    Ok(Resolved { weapon, mods, arcane, evolutions, enemy, warnings })
}

fn condition_scale(m: &Modifier, c: &Conditions) -> f64 {
    if m.trigger.as_ref().is_some_and(|t| !c.triggers.contains(t)) {
        return 0.0;
    }
    let stacks = m.max_stacks.max(1) as f64;
    let cond = match m.condition {
        Condition::Always | Condition::CritChanceBelow => 1.0,
        Condition::StatusTypesBelow => {
            if c.status_types < m.threshold.unwrap_or(0.0) {
                1.0
            } else {
                0.0
            }
        }
        Condition::OnHeadshot | Condition::OnHeadshotKill | Condition::HeadshotShare if !c.headshot_effects || c.companion => 0.0,
        Condition::HeadshotShare => c.headshot_share.clamp(0.0, 1.0),
        Condition::OnReload if c.no_reload => 0.0,
        Condition::OnReload => c.conditional_uptime.clamp(0.0, 1.0) * stacks * c.reload_share.unwrap_or(1.0),
        _ => c.conditional_uptime.clamp(0.0, 1.0) * stacks,
    };
    let per = match m.per {
        None => 1.0,
        Some(PerCount::StatusType) => c.status_types.max(0.0),
        Some(PerCount::ComboMultiplier) => (c.combo_multiplier - 1.0).max(0.0),
        Some(PerCount::Shields200) => (c.shields.max(0.0) / 200.0).floor().min(stacks),
    };
    cond * per
}

fn filter_ok(f: ComponentFilter, comp: &HitComponent) -> bool {
    match f {
        ComponentFilter::All => true,
        ComponentFilter::DirectOnly => comp.kind != HitKind::Radial,
        ComponentFilter::RadialOnly => comp.kind == HitKind::Radial,
        ComponentFilter::HeavyOnly => comp.rules.heavy || comp.rules.tennokai,
        ComponentFilter::TennokaiOnly => comp.rules.tennokai,
    }
}

/// Combo multiplier in effect for a hit: regular heavies consume the heavy combo; light hits and
/// Tennokai heavies (which don't consume combo) see the light build's combo.
fn combo_for(c: &Conditions, rules: &HitRules) -> f64 {
    if rules.combo_scaling && !rules.tennokai {
        c.heavy_combo_multiplier.max(1.0)
    } else {
        c.combo_multiplier.max(1.0)
    }
}

fn with_combo(c: &Conditions, combo: f64) -> Conditions {
    Conditions { combo_multiplier: combo, ..c.clone() }
}

pub fn compute(data: &GameData, build: &Build, target: &Target) -> Result<BuildResult, CalcError> {
    let r = resolve(data, build, target)?;
    Ok(compute_resolved(r, build, target))
}

/// One attack mode for an already-resolved build (optimizer hot path).
pub fn evaluate(r: &Resolved, build: &Build, target: &Target, mode: usize) -> Result<ModeResult, CalcError> {
    let m = r
        .weapon
        .modes
        .get(mode)
        .ok_or_else(|| CalcError::new(ErrorCode::MissingField, format!("no mode {mode}")))?;
    compute_mode(r, build, target, m, mode)
}

pub fn compute_resolved(r: Resolved, build: &Build, target: &Target) -> BuildResult {
    let mut modes = Vec::new();
    let mut failed_modes = Vec::new();
    for (i, mode) in r.weapon.modes.iter().enumerate() {
        match compute_mode(&r, build, target, mode, i) {
            Ok(m) => modes.push(m),
            Err(error) => failed_modes.push(ModeFailure { mode: mode.name.clone(), mode_index: i, error }),
        }
    }
    BuildResult {
        weapon: r.weapon.name.clone(),
        weapon_id: r.weapon.id.clone(),
        target: r.enemy.as_ref().map(|e| e.name.clone()).unwrap_or_else(|| "Raw (unarmored target)".into()),
        modes,
        failed_modes,
        warnings: r.warnings,
    }
}

fn all_modifiers<'a>(r: &'a Resolved, build: &'a Build, mode: &'a AttackMode) -> impl Iterator<Item = &'a Modifier> {
    let slot = r.weapon.slot;
    // Companion weapons are fired by AI: never aiming.
    let companion = slot == Slot::Companion;
    r.weapon
        .innate
        .iter()
        .chain(r.mods.iter().flat_map(|m| m.modifiers.iter()))
        .chain(r.arcane.iter().flat_map(|a| a.modifiers.iter()))
        .chain(r.evolutions.iter().filter(move |e| form_ok(e.forms, mode)).flat_map(|e| e.modifiers.iter()))
        .chain(build.riven.iter())
        .chain(build.buffs.iter())
        .filter(move |m| !(companion && m.aiming))
        .filter(move |m| (m.only_slots.is_empty() || m.only_slots.contains(&slot)) && !m.not_slots.contains(&slot))
        .filter(move |m| m.mode_contains.as_deref().map_or(true, |s| mode.name.contains(s)))
}

/// Rounds in one Incarnon charge (0 when unknown).
fn mode_rounds(mode: &AttackMode) -> f64 {
    match &mode.ammo_pool {
        AmmoPool::Incarnon { rounds: Some(n), .. } => *n as f64,
        _ => 0.0,
    }
}

fn finite(v: f64, what: &str) -> Result<f64, CalcError> {
    if v.is_finite() {
        Ok(v)
    } else {
        Err(CalcError::new(ErrorCode::NonFinite, format!("{what} is not finite")))
    }
}

/// Approximation notes for a mode. With Conditions::calc_only nothing is formatted, but whether any
/// note applied is still tracked (it decides the coverage label).
struct Notes {
    on: bool,
    any: bool,
    list: Vec<String>,
}

impl Notes {
    fn new(on: bool, initial: &[String]) -> Self {
        Notes { on, any: false, list: if on { initial.to_vec() } else { Vec::new() } }
    }

    fn add(&mut self, f: impl FnOnce() -> String) {
        self.any = true;
        if self.on {
            self.list.push(f());
        }
    }
}

struct Partial {
    name: String,
    kind: HitKind,
    /// Radius of a radial hit (falloff end), for group fights.
    radius: Option<f64>,
    /// Sum of elemental mod bonuses per type (Heat, Toxin, Electricity and Gas ticks scale with it).
    elem_bonus: BTreeMap<DamageType, f64>,
    forced: Vec<DamageType>,
    falloff: Option<Falloff>,
    punch_through: f64,
    status_damage: f64,
    damage: DamageMap,
    projectiles: f64,
    crit_chance: f64,
    arsenal_crit_chance: f64,
    crit_mult: f64,
    status_chance: f64,
    crit_hs: f64,
    faction: f64,
    ability: f64,
    modded_base: f64,
    explain: Vec<Explain>,
}

/// Arcane behaviours the engine implements (others are reported as not modelled).
const ARCANE_BEHAVIOURS: [&str; 4] = ["enervate", "meleeDuplicate", "meleeDoughty", "meleeInfluence"];

/// A status-stack arcane (Primary Blight, Cascadia Flare, Secondary Shiver...) needs the weapon's own
/// procs, which the arcane can raise (Blight adds multishot): evaluate, derive the stacks, repeat.
/// Stacks only grow with each pass, so this settles in a few passes.
/// Damage multiplier at distance `d` for a falloff profile.
fn falloff_at(f: &Falloff, d: f64) -> f64 {
    if d <= f.start_m || f.end_m <= f.start_m {
        return 1.0;
    }
    let t = ((d - f.start_m) / (f.end_m - f.start_m)).min(1.0);
    1.0 - f.reduction.clamp(0.0, 1.0) * t
}

/// Average falloff over enemies spread evenly across the explosion's area.
fn average_falloff(f: &Falloff) -> f64 {
    let r = f.end_m.max(0.1);
    let n = 24;
    (0..n)
        .map(|i| {
            let d = r * (i as f64 + 0.5) / n as f64;
            falloff_at(f, d) * 2.0 * d / (r * r) * (r / n as f64)
        })
        .sum()
}

/// Puncture and Cold on the target raise crit chance / crit damage of direct hits; their stacks come
/// from the weapon's own procs, so evaluate once, derive the stacks, evaluate again.
fn compute_mode(r: &Resolved, build: &Build, target: &Target, mode: &AttackMode, index: usize) -> Result<ModeResult, CalcError> {
    let first = compute_mode_stacked(r, build, target, mode, index)?;
    let sd = first.status_duration_s / STATUS_DURATION_S;
    let pps = |t: DamageType| first.procs_per_s.get(&t).copied().unwrap_or(0.0);
    // Puncture: +5% crit chance per stack, 5 stacks of 10 s.
    let puncture = (pps(DamageType::Puncture) * 10.0 * sd).min(5.0);
    // Cold: +0.1x crit damage at 1 stack, +0.05x per stack to +0.5x at 9; frozen at 10 (+1.0x for 3 s,
    // then 3 stacks remain).
    let pc = pps(DamageType::Cold);
    let cold = (pc * STATUS_DURATION_S * sd).min(10.0);
    let below = |n: f64| if n >= 1.0 { (0.1 + 0.05 * (n.min(9.0) - 1.0)).min(0.5) } else { 0.1 * n };
    let cold_cd = if cold >= 10.0 && pc > 0.0 {
        let freeze = 3.0 * sd;
        let rebuild = 7.0 / pc;
        (1.0 * freeze + 0.5 * rebuild) / (freeze + rebuild)
    } else {
        below(cold)
    };
    let cc = 0.05 * puncture;
    // Infinite ammo on headshots: on-reload effects only get the reloads that are left.
    let reload_share = (first.free_ammo > 0.01).then(|| 1.0 - first.free_ammo);
    if cc < 1e-6 && cold_cd < 1e-6 && reload_share.is_none() {
        return Ok(first);
    }
    let mut b = build.clone();
    b.conditions.target_crit_chance = cc;
    b.conditions.target_crit_damage = cold_cd;
    b.conditions.reload_share = reload_share;
    let mut res = compute_mode_stacked(r, &b, target, mode, index)?;
    if build.conditions.calc_only {
        return Ok(res);
    }
    res.approximations.push(format!(
        "Target status from this weapon: {puncture:.1} Puncture stacks (+{:.0}% crit chance), {cold:.1} Cold stacks (+{cold_cd:.2}x crit damage), direct hits only",
        cc * 100.0
    ));
    Ok(res)
}

fn compute_mode_stacked(r: &Resolved, build: &Build, target: &Target, mode: &AttackMode, index: usize) -> Result<ModeResult, CalcError> {
    let Some((arcane, st)) = r.arcane.and_then(|a| a.stacking.as_ref().map(|s| (a, s))) else {
        return compute_mode_once(r, build, target, mode, index);
    };
    let at = |stacks: f64| {
        let scaled = Arcane {
            modifiers: arcane
                .modifiers
                .iter()
                .map(|m| Modifier {
                    value: m.value * stacks,
                    source: if build.conditions.calc_only { String::new() } else { format!("{} ({stacks:.1} stacks)", m.source) },
                    ..m.clone()
                })
                .collect(),
            stacking: None,
            ..arcane.clone()
        };
        let rr = Resolved {
            weapon: r.weapon,
            mods: r.mods.clone(),
            arcane: Some(&scaled),
            evolutions: r.evolutions.clone(),
            enemy: r.enemy.clone(),
            warnings: vec![],
        };
        compute_mode_once(&rr, build, target, mode, index)
    };
    let stacks_of = |res: &ModeResult| {
        let pps = res.procs_per_s.get(&st.status).copied().unwrap_or(0.0);
        match st.duration_s {
            // Shared timer refreshed by every proc: full stacks once procs outpace it.
            Some(d) if pps * d >= 1.0 => st.max_stacks,
            Some(d) => pps * d,
            None => (pps * res.status_duration_s).min(st.max_stacks),
        }
    };
    let mut stacks = 0.0;
    let mut res = at(stacks)?;
    for _ in 0..4 {
        let next = stacks_of(&res).max(stacks);
        if next - stacks < 0.01 {
            break;
        }
        stacks = next;
        res = at(stacks)?;
    }
    if res.coverage == Coverage::Computed {
        res.coverage = Coverage::Approximate;
    }
    if build.conditions.calc_only {
        return Ok(res);
    }
    let pps = res.procs_per_s.get(&st.status).copied().unwrap_or(0.0);
    res.approximations.push(match st.duration_s {
        Some(d) => format!(
            "{}: {stacks:.1} of {} stacks from {:.2} {:?} procs/s (shared {d} s timer{})",
            arcane.name,
            st.max_stacks,
            pps,
            st.status,
            if pps > 0.0 { format!(", full after {:.0} s", st.max_stacks / pps) } else { String::new() }
        ),
        None => format!("{}: {stacks:.1} {:?} stacks kept on the target by this weapon", arcane.name, st.status),
    });
    Ok(res)
}

fn compute_mode_once(
    r: &Resolved,
    build: &Build,
    target: &Target,
    mode: &AttackMode,
    index: usize,
) -> Result<ModeResult, CalcError> {
    let quiet = build.conditions.calc_only;
    let mut approx = Notes::new(!quiet, &mode.notes);
    if mode.coverage == Coverage::Unsupported {
        return Err(CalcError::new(
            ErrorCode::UnknownMechanic,
            format!("{} / {} is marked unsupported: {}", r.weapon.name, mode.name, mode.notes.join("; ")),
        ));
    }
    if mode.components.is_empty() {
        return Err(CalcError::new(ErrorCode::MissingField, format!("{} has no hit components", mode.name)));
    }
    let faction = r.enemy.as_ref().map(|e| e.faction).unwrap_or(Faction::None);

    // Companion weapons: AI fire, so no aiming, headshot effects or headshot share.
    let companion = r.weapon.slot == Slot::Companion;
    let mut base_cond = Conditions {
        companion,
        headshot_share: if companion { 0.0 } else { build.conditions.headshot_share },
        no_reload: mode.magazine.is_none() || mode.reload_s <= 0.0 || matches!(mode.ammo_pool, AmmoPool::Incarnon { .. }),
        ..build.conditions.clone()
    };
    if let Some((name, floor)) = r.arcane.and_then(|a| a.combo_floor.map(|f| (&a.name, f))) {
        if base_cond.combo_multiplier < floor || base_cond.heavy_combo_multiplier < floor {
            approx.add(|| format!("{name}: combo never below {floor}x (built up from finisher kills over the mission)"));
        }
        base_cond.combo_multiplier = base_cond.combo_multiplier.max(floor);
        base_cond.heavy_combo_multiplier = base_cond.heavy_combo_multiplier.max(floor);
    }
    // Heavy attacks spend the combo; it has to come back before the next one. The heavy is thrown at the
    // scenario's heavy combo or at the Initial Combo floor, whichever is higher.
    let mut heavy_plan = None;
    if mode.melee_role == Some(MeleeRole::Heavy) {
        let mut pre = Pools::new(base_cond.calc_only);
        for m in all_modifiers(r, build, mode) {
            pre.add(m, condition_scale(m, &base_cond));
        }
        let floor = r.arcane.and_then(|a| a.combo_floor).map_or(0.0, |f| COMBO_POINTS_PER_TIER * (f - 1.0));
        let initial = (pre.initial_combo.max(0.0) + floor).min(COMBO_POINTS_PER_TIER * 11.0);
        let target = COMBO_POINTS_PER_TIER * (build.conditions.heavy_combo_multiplier - 1.0).max(0.0);
        let points = target.max(initial).min(COMBO_POINTS_PER_TIER * 11.0);
        base_cond.heavy_combo_multiplier = 1.0 + (points / COMBO_POINTS_PER_TIER).floor();
        heavy_plan = Some((points, initial, pre.heavy_eff.clamp(0.0, HEAVY_EFFICIENCY_CAP)));
    }
    let mut partials = Vec::new();
    let mode_combo = mode.components.first().map_or(base_cond.combo_multiplier, |c| combo_for(&base_cond, &c.rules));
    let mode_cond = with_combo(&base_cond, mode_combo);
    let mut mode_pools = Pools::new(base_cond.calc_only);
    for m in all_modifiers(r, build, mode) {
        mode_pools.add(m, condition_scale(m, &mode_cond));
    }

    // Rate, magazine, reload (the rate is needed first: hit-rate-driven behaviours use it).
    let locked = r.mods.iter().find(|m| m.locks_fire_rate);
    let fr_bonus = if locked.is_some() {
        0.0
    } else if r.weapon.class == WeaponClass::Bow {
        mode_pools.fire_rate * 2.0
    } else {
        mode_pools.fire_rate
    };
    let fr_mult = (1.0 + fr_bonus).max(0.05);
    let rate = match mode.charge_time_s {
        Some(ct) if ct > 0.0 => {
            let base_cycle = if mode.fire_rate > 0.0 { ct.max(1.0 / mode.fire_rate) } else { ct };
            approx.add(|| "Charge timing simplified: cycle = max(charge time, 1/fire rate) ÷ fire-rate bonus".into());
            fr_mult / base_cycle
        }
        _ if mode.melee_role == Some(MeleeRole::Heavy) => mode.fire_rate * fr_mult * (1.0 + mode_pools.wind_up).max(0.05),
        _ => mode.fire_rate * fr_mult,
    };
    // Light hits per second of the weapon's fastest stance combo, for rebuilding combo.
    let light_hits = r
        .weapon
        .modes
        .iter()
        .filter(|m| m.melee_role == Some(MeleeRole::Light))
        .map(|m| m.fire_rate * fr_mult * m.components.iter().map(|c| c.multishot).sum::<f64>())
        .fold(0.0, f64::max);
    let rate = if let Some((points, initial, eff)) = heavy_plan {
        let kept = eff * points;
        // Initial Combo regenerates at 40/s; combo above it comes from light hits.
        let regen = (initial.min(points) - kept).max(0.0) / INITIAL_COMBO_REGEN;
        let hits = (points - kept.max(initial)).max(0.0);
        let rebuild = regen + if light_hits > 0.0 { hits / light_hits } else { 0.0 };
        approx.add(|| format!(
            "Heavy rotation: {:.0}x combo ({points:.0} points); keeps {:.0}% ({kept:.0}), {regen:.1}s of Initial Combo regen + {hits:.0} light hits to rebuild ({rebuild:.1}s), then the wind-up",
            1.0 + (points / COMBO_POINTS_PER_TIER).floor(),
            eff * 100.0
        ));
        1.0 / (1.0 / rate + rebuild)
    } else if mode.melee_role == Some(MeleeRole::Tennokai) && light_hits > 0.0 {
        let every = r.mods.iter().filter_map(|m| m.tennokai_every).min().map_or(1.0 / TENNOKAI_CHANCE, |n| n as f64);
        approx.add(|| format!("Tennokai rotation: one Tennokai heavy every {every:.1} light hits"));
        1.0 / (1.0 / rate + every / light_hits)
    } else {
        rate
    };
    if !(rate > 0.0) {
        return Err(CalcError::new(ErrorCode::InvalidValue, format!("{} has no fire rate", mode.name)));
    }
    let behaviours: Vec<(&str, &BehaviourDef)> = r
        .evolutions
        .iter()
        .filter(|e| form_ok(e.forms, mode))
        .filter_map(|e| e.behaviour.as_ref().map(|b| (e.name.as_str(), b)))
        .collect();
    for comp in &mode.components {
        let cond = with_combo(&base_cond, combo_for(&base_cond, &comp.rules));
        let mut p = Pools::new(base_cond.calc_only);
        for m in all_modifiers(r, build, mode).filter(|m| filter_ok(m.applies_to, comp)) {
            p.add(m, condition_scale(m, &cond));
        }
        let progenitor = build.progenitor.filter(|_| r.weapon.progenitor);
        partials.push(component(r, comp, &p, faction, &cond, rate, &behaviours, progenitor, &mut approx)?);
    }

    let magazine = mode.magazine.map(|m| ((m as f64) * (1.0 + mode_pools.magazine)).round().max(1.0) as u32);
    // Attacks per magazine: an attack may use several rounds (Ballistica Prime's 4 bolts, 4 rounds).
    // A beam fired while charging (Onos): its ticks use rounds and deal damage during each charge.
    let beam = mode
        .charge_beam
        .filter(|i| *i != index)
        .and_then(|i| r.weapon.modes.get(i).map(|m| (i, m)))
        .and_then(|(i, m)| compute_mode(r, build, target, m, i).ok());
    let beam_ticks = beam.as_ref().map_or(0.0, |b| b.fire_rate / rate);
    // Ammo efficiency: the share of rounds not used, capped at 75%.
    let ammo_eff = mode_pools.ammo_eff.clamp(0.0, AMMO_EFFICIENCY_CAP);
    // Infinite ammo on headshots (Skull Shots): the buff is up 1 - e^(-triggers/s x duration) of the
    // time. Headshots use the scenario's share, or the on-headshot assumption when it is 0.
    let headshot_rate = {
        let share = if base_cond.companion || !base_cond.headshot_effects {
            0.0
        } else if base_cond.headshot_share > 0.0 {
            base_cond.headshot_share
        } else {
            base_cond.conditional_uptime
        };
        rate * partials.first().map_or(1.0, |p| p.projectiles) * share.clamp(0.0, 1.0)
    };
    let free_ammo = 1.0
        - mode_pools
            .infinite_ammo
            .iter()
            .map(|(chance, secs)| (-(chance * headshot_rate * secs)).exp())
            .product::<f64>();
    if free_ammo > 0.01 {
        approx.add(|| format!("Infinite ammo on headshots: active {:.0}% of the time", free_ammo * 100.0));
    }
    let ammo_cost = (mode.ammo_cost.max(1.0) + beam_ticks) * (1.0 - ammo_eff) * (1.0 - free_ammo);
    let endless = ammo_cost <= 1e-9;
    let magazine_shots = if endless { None } else { magazine.map(|m| (m as f64 / ammo_cost).floor().max(1.0)) };
    let reload = mode.reload_s / (1.0 + mode_pools.reload).max(0.05);

    // Status procs per second, per type, summed over components.
    let duration = STATUS_DURATION_S * (1.0 + mode_pools.status_duration);
    let mut procs: BTreeMap<DamageType, f64> = BTreeMap::new();
    for p in &partials {
        let total: f64 = p.damage.values().sum();
        if total <= 0.0 {
            continue;
        }
        for (t, d) in &p.damage {
            *procs.entry(*t).or_default() += p.status_chance * p.projectiles * rate * d / total;
        }
        for t in &p.forced {
            *procs.entry(*t).or_default() += p.projectiles * rate;
        }
    }
    let stacks = |t: DamageType| (procs.get(&t).copied().unwrap_or(0.0) * duration).min(10.0);
    // Outsourced status (allies, abilities) only raises stacks above what the weapon keeps up itself.
    let own_viral = stacks(DamageType::Viral);
    let own_corr = stacks(DamageType::Corrosive);
    let viral_n = target.viral_stacks.map_or(own_viral, |v| v.clamp(0.0, 10.0).max(own_viral));
    let corr_n = target.corrosive_stacks.map_or(own_corr, |v| v.clamp(0.0, 10.0).max(own_corr));
    let heat_on = target.heat_active.unwrap_or(false) || stacks(DamageType::Heat) >= 1.0;

    // Enemy multipliers.
    let (dr, viral_mult, enemy_explain) = match &r.enemy {
        Some(e) => {
            let s_corr = if corr_n >= 1.0 { (0.26 + 0.06 * (corr_n - 1.0)).min(0.8) } else { 0.26 * corr_n };
            let s_heat = if heat_on { 0.5 } else { 0.0 };
            let s_cp = (CORROSIVE_PROJECTION * target.corrosive_projection.clamp(0.0, 4.0)).min(1.0);
            let (mut s_evo, mut evo_strip) = (0.0, Vec::new());
            for (name, b) in &behaviours {
                if let BehaviourDef::ArmorStripPerStatus { status, per_stack } = b {
                    let n = stacks(*status);
                    let s = (per_stack * n).clamp(0.0, 1.0);
                    s_evo = 1.0 - (1.0 - s_evo) * (1.0 - s);
                    if !quiet {
                        evo_strip.push(Explain::new(name.to_string(), s).detail(format!("{n:.2} {status:?} stacks x {:.0}%", per_stack * 100.0)));
                    }
                }
            }
            let eff_armor = e.armor.min(ARMOR_CAP)
                * (1.0 - s_heat)
                * (1.0 - s_corr)
                * (1.0 - s_cp)
                * (1.0 - s_evo)
                * (1.0 - target.armor_strip.clamp(0.0, 1.0));
            let dr = MAX_DR * (eff_armor / ARMOR_CAP).sqrt();
            let v = if viral_n >= 1.0 { 2.0 + 0.25 * (viral_n.min(10.0) - 1.0) } else { 1.0 + viral_n };
            if viral_n > 0.0 && viral_n < 1.0 {
                approx.add(|| "Viral below one steady-state stack: uptime interpolated linearly".into());
            }
            if e.health_modifiers.is_empty() {
                approx.add(|| format!("{}: health-class damage modifiers not set; armor and status only", e.name));
            }
            let ex = (!quiet).then(|| Explain::new(format!("Enemy: {}", e.name), (1.0 - dr) * v).with(vec![
                Explain::new("Armor (capped)", e.armor.min(ARMOR_CAP)),
                Explain::new("Corrosive strip", s_corr).detail(format!(
                    "{corr_n:.2} stacks ({own_corr:.2} from this weapon{})",
                    target.corrosive_stacks.map(|x| format!(", {x:.0} outsourced")).unwrap_or_default()
                )),
                Explain::new("Heat strip", s_heat),
                Explain::new("Corrosive Projection", s_cp).detail(format!("{} aura(s) x 18%", target.corrosive_projection)),
                Explain::new("External strip", target.armor_strip),
                Explain::new("Evolution strip", s_evo).with(evo_strip),
                Explain::new("Effective armor", eff_armor),
                Explain::new("Damage reduction", dr).detail("0.9·√(armor/2700)"),
                Explain::new("Viral multiplier", v).detail(format!(
                    "{viral_n:.2} stacks ({own_viral:.2} from this weapon{})",
                    target.viral_stacks.map(|x| format!(", {x:.0} outsourced")).unwrap_or_default()
                )),
            ]));
            (dr, v, ex)
        }
        // No enemy = an unarmored target: status effects still apply (Viral), armor doesn't.
        None => {
            let v = if viral_n >= 1.0 { 2.0 + 0.25 * (viral_n.min(10.0) - 1.0) } else { 1.0 + viral_n };
            let ex = (viral_n > 0.0 && !quiet).then(|| {
                Explain::new("Target: unarmored (raw)", v)
                    .child(Explain::new("Viral multiplier", v).detail(format!("{viral_n:.2} stacks ({own_viral:.2} from this weapon)")))
            });
            (0.0, v, ex)
        }
    };

    let mut components = Vec::new();
    let (mut shot_raw, mut shot_target) = (0.0, 0.0);
    // Group fight: how many enemies an effect of radius r reaches, and melee swings with follow-through.
    let group_n = build.conditions.group_size.max(1.0);
    let reach = |radius: f64| (group_n * radius / GROUP_SPREAD_M).round().clamp(1.0, group_n);
    let melee_factor = r.weapon.melee.as_ref().map_or(1.0, |m| {
        let k = reach(m.range_m + mode_pools.range) as i32;
        (0..k).map(|i| m.follow_through.powi(i)).sum::<f64>()
    });
    let vs = |t: DamageType| {
        let hm = r.enemy.as_ref().and_then(|e| e.health_modifiers.get(&t)).copied().unwrap_or(1.0);
        let armor = if t == DamageType::Slash || t == DamageType::True { 1.0 } else { 1.0 - dr };
        hm * armor * viral_mult
    };
    // Per damaging status: (procs/s on the main target, procs/s x damage per tick or proc, procs/s on the
    // group, procs/s x raw damage per tick: no armor, health class or Viral).
    let mut st: BTreeMap<DamageType, (f64, f64, f64, f64)> = BTreeMap::new();
    let (mut group_shot, mut influence_hit, mut faction_f) = (0.0, 0.0, 1.0);
    let explosive = mode.components.iter().any(|c| c.kind == HitKind::Radial);
    for p in partials {
        faction_f = p.faction;
        let factor = match p.kind {
            HitKind::Melee => melee_factor,
            // The other enemies in the blast stand spread over it: average falloff.
            HitKind::Radial => {
                let k = reach(p.radius.unwrap_or(GROUP_SPREAD_M));
                1.0 + (k - 1.0) * p.falloff.as_ref().map_or(1.0, average_falloff)
            }
            _ => {
                // Punch through passes about one enemy per meter (at most 2 more); chaining beams reach more.
                // Rounds that explode on impact (a radial component) stop at the first enemy.
                let budget = group_n - 1.0;
                let pierced = if explosive { 0.0 } else { p.punch_through.floor().min(PIERCE_MAX_EXTRA).min(budget).max(0.0) };
                let chained: f64 = r.weapon.chain.as_ref().map_or(0.0, |c| {
                    c.damage.iter().take((budget - pierced).max(0.0) as usize).sum()
                });
                1.0 + pierced + chained
            }
        };
        let total: f64 = p.damage.values().sum::<f64>().max(f64::MIN_POSITIVE);
        let hits = p.projectiles * rate;
        let base = p.modded_base * p.faction * p.faction * (1.0 + p.crit_chance * (p.crit_mult - 1.0)) * p.ability * (1.0 + p.status_damage).max(0.0);
        for t in DAMAGING_STATUS {
            let forced = p.forced.iter().filter(|x| **x == t).count() as f64;
            let pps = hits * (p.status_chance * p.damage.get(&t).copied().unwrap_or(0.0) / total + forced);
            if !(pps > 0.0) {
                continue;
            }
            let raw = match t {
                DamageType::Slash => 0.35 * base,
                DamageType::Blast => 0.3 * base,
                _ => 0.5 * base * (1.0 + p.elem_bonus.get(&t).copied().unwrap_or(0.0)).max(0.0),
            };
            let e = st.entry(t).or_default();
            e.0 += pps;
            e.1 += pps * raw * vs(t);
            e.2 += pps * factor;
            e.3 += pps * raw;
        }
        // Melee Influence copies each elemental proc's element damage (faction once more) to the group.
        for (t, d) in &p.damage {
            if t.is_physical() || matches!(t, DamageType::Void | DamageType::Tau | DamageType::True) {
                continue;
            }
            let pps = hits * p.status_chance * d / total;
            influence_hit += pps * d * p.faction * p.crit_hs * p.ability * vs(*t) * p.faction;
        }
        let raw_hit: f64 = p.damage.values().sum::<f64>() * p.faction * p.crit_hs * p.ability;
        let target_hit: f64 = p
            .damage
            .iter()
            .map(|(t, d)| {
                let hm = r.enemy.as_ref().and_then(|e| e.health_modifiers.get(t)).copied().unwrap_or(1.0);
                let armor = if *t == DamageType::True { 1.0 } else { 1.0 - dr };
                d * hm * armor
            })
            .sum::<f64>()
            * p.faction
            * p.crit_hs
            * p.ability
            * viral_mult;
        shot_raw += raw_hit * p.projectiles;
        shot_target += target_hit * p.projectiles;
        group_shot += target_hit * p.projectiles * factor;
        let ex = if quiet {
            Explain::default()
        } else {
            Explain::new(format!("{} per shot", p.name), target_hit * p.projectiles)
                .with(p.explain)
                .child(Explain::new("Projectiles", p.projectiles))
        };
        components.push(ComponentResult {
            name: p.name,
            damage: p.damage,
            per_projectile_raw: finite(raw_hit, "raw hit")?,
            per_projectile_target: finite(target_hit, "hit vs target")?,
            projectiles: p.projectiles,
            crit_chance: p.crit_chance,
            arsenal_crit_chance: p.arsenal_crit_chance,
            crit_mult: p.crit_mult,
            status_chance: p.status_chance,
            explain: ex,
        });
    }

    if let Some(b) = &beam {
        shot_target += b.per_shot * beam_ticks;
        shot_raw += b.per_shot_raw * beam_ticks;
        group_shot += b.group_dps / rate;
        approx.add(|| format!("Charging fires {}: {beam_ticks:.1} beam ticks per charge (damage and rounds counted)", b.mode));
    }

    // Status damage per second. Slash/Toxin/Electricity stack without limit (each proc ticks once a
    // second for the status duration); Heat procs refresh every stack, so they keep growing for the
    // fight; Gas keeps at most 10 clouds; Blast deals 30% per proc and, at 10 stacks within its fuse,
    // detonates for 300% per stack on the enemies around.
    let fight = build.conditions.fight_s.max(0.0);
    let fuse = BLAST_FUSE_S * duration / STATUS_DURATION_S;
    let (mut status_dps, mut group_status, mut status_raw) = (0.0, 0.0, 0.0);
    let mut per_proc: BTreeMap<DamageType, f64> = BTreeMap::new();
    // Contagious Bond spreads half of each status's stacks (at most 100) from the companion's kills.
    let mut bond_per_enemy = 0.0;
    // Per status: (damage per tick or proc, stacks alive, procs/s), for on-kill effects.
    let mut tick_alive: BTreeMap<DamageType, (f64, f64, f64)> = BTreeMap::new();
    let mut status_explain = Vec::new();
    for (t, (pps, sum, gpps, sum_raw)) in &st {
        let per = sum / pps;
        // Stacks alive on average over the fight (0 = steady state). Timed stacks ramp up to
        // procs/s x duration over the first `duration` seconds. Heat stacks are all refreshed by each new
        // proc, so under constant fire none expire: procs/s x time firing, whatever the duration.
        let timed = |d: f64| match fight {
            f if f <= 0.0 => pps * d,
            f if f <= d => pps * f / 2.0,
            f => pps * d * (1.0 - d / (2.0 * f)),
        };
        let refreshing = *t == DamageType::Heat && pps * duration >= 1.0 && fight > 0.0;
        let (alive, aoe) = match t {
            DamageType::Heat if refreshing => (pps * fight / 2.0, 1.0),
            DamageType::Gas => (timed(duration).min(GAS_MAX_STACKS), reach(GAS_RADIUS_M)),
            DamageType::Electricity => (timed(duration), reach(ELECTRICITY_RADIUS_M)),
            DamageType::Blast => (*pps, 1.0),
            _ => (timed(duration), 1.0),
        };
        let single = alive * per;
        status_dps += single;
        status_raw += alive * sum_raw / pps;
        if *t != DamageType::Blast {
            bond_per_enemy += (0.5 * alive).min(CONTAGIOUS_BOND_MAX_STACKS) * per;
        }
        group_status += single * (gpps / pps) + single * (aoe - 1.0);
        per_proc.insert(*t, single / pps);
        tick_alive.insert(*t, (per, alive, *pps));
        let detonates = *t == DamageType::Blast && pps * fuse >= BLAST_STACKS;
        if detonates {
            // Detonations every 10 procs: 300% per stack to every other enemy within 5 m.
            let aoe_dps = pps / BLAST_STACKS * BLAST_STACKS * 10.0 * per;
            group_status += aoe_dps * (reach(BLAST_RADIUS_M) - 1.0);
        }
        if !quiet {
            let mut detail = format!("{pps:.2} procs/s, {per:.0} per {}", if *t == DamageType::Blast { "proc" } else { "tick" });
            if detonates {
                detail.push_str("; reaches 10 stacks: detonations hit the group");
            } else if refreshing {
                detail.push_str(&format!("; stacks refresh under constant fire, averaged over a {fight:.0} s fight (duration doesn't matter)"));
            } else if *t == DamageType::Gas && pps * duration > GAS_MAX_STACKS {
                detail.push_str("; capped at 10 clouds");
            }
            status_explain.push(Explain::new(format!("{t:?}"), single).detail(detail));
        }
    }
    if let Some(b) = &beam {
        status_dps += b.status_dps;
        status_raw += b.status_dps;
    }
    // Melee Influence: while active (20% per Electricity proc, 18 s, re-triggers after it ends), every
    // elemental proc on the target spreads its element damage and the proc to the group, faction counted
    // once more on each.
    let mut influence = 0.0;
    if r.arcane.and_then(|a| a.behaviour.as_deref()) == Some("meleeInfluence") {
        let pe = procs.get(&DamageType::Electricity).copied().unwrap_or(0.0);
        let uptime = if pe > 0.0 { INFLUENCE_DURATION_S / (INFLUENCE_DURATION_S + 1.0 / (INFLUENCE_CHANCE * pe)) } else { 0.0 };
        let dots: f64 = st
            .iter()
            .filter(|(t, _)| **t != DamageType::Slash)
            .map(|(t, (pps, _, _, _))| pps * per_proc.get(t).copied().unwrap_or(0.0) * faction_f)
            .sum();
        influence = (group_n - 1.0) * uptime * (influence_hit + dots);
        approx.add(|| format!(
            "Melee Influence: {:.0}% uptime from {pe:.2} Electricity procs/s; spreads elemental damage and procs to the other {} enemies",
            uptime * 100.0,
            group_n - 1.0
        ));
    }
    if group_n > 1.0 {
        approx.add(|| format!(
            "Group: {group_n:.0} enemies within {GROUP_SPREAD_M} m{}; radial hits, Gas, Electricity and Blast reach part of them by radius",
            if r.weapon.melee.is_some() { format!(", a swing reaches {:.0} (x{melee_factor:.2} with follow-through)", reach(r.weapon.melee.as_ref().map_or(0.0, |m| m.range_m + mode_pools.range))) } else { String::new() }
        ));
    }

    // With a one-round magazine every shot is followed by a reload: there is no burst window.
    let single_round = magazine_shots == Some(1.0) && mode.reload_s > 0.0 && !endless;
    if single_round {
        approx.add(|| "One-round magazine: burst DPS includes the reload after every shot".into());
    }
    let cycle = if single_round { 1.0 / rate + reload } else { 1.0 / rate };
    // Raw: hits and status damage on an unarmored target with no Viral or other enemy-side multiplier.
    let burst_raw = shot_raw / cycle + status_raw;
    let hit_burst = shot_target / cycle;
    let burst = hit_burst + status_dps;
    let (sustained, per_charge) = match (&mode.ammo_pool, magazine) {
        (AmmoPool::Incarnon { rounds: Some(n), recharge_s, charge_gain, charge_on_any_hit }, _) => {
            // Attacks per full gauge; the gauge refill still counts every round.
            let gauge = *n as f64;
            let n = if endless { 1e12 } else { (gauge / ammo_cost).max(1.0) };
            // Normal-form time refilling the gauge, and the normal form's DPS meanwhile.
            let charging = match (recharge_s, charge_gain) {
                (Some(t), _) => Some((*t, 0.0)),
                (None, Some(g)) if *g > 0.0 => incarnon_recharge(r, build, target, gauge, *g, *charge_on_any_hit, &mut approx),
                _ => None,
            };
            match charging {
                Some((t, normal_dps)) => ((shot_target * n + normal_dps * t) / (n / rate + t), Some(shot_target * n)),
                None => {
                    approx.add(|| "Incarnon recharge unknown: sustained DPS shown as burst; see damage per charge".into());
                    (hit_burst, Some(shot_target * n))
                }
            }
        }
        (AmmoPool::Incarnon { .. }, _) => {
            approx.add(|| "Incarnon ammo pool unknown: sustained DPS shown as burst".into());
            (hit_burst, None)
        }
        // Magazine weapons (beams included): a magazine's worth of shots, then the reload.
        (_, Some(_)) if !single_round && !endless => {
            let m = magazine_shots.unwrap_or(1.0);
            (shot_target * m / (m / rate + reload), None)
        }
        _ => (hit_burst, None),
    };
    // Status damage keeps the same uptime as the hits.
    let uptime = if hit_burst > 0.0 { (sustained / hit_burst).min(1.0) } else { 1.0 };
    let sustained = sustained + status_dps * uptime;
    let per_charge = per_charge.filter(|_| !endless).map(|c| c + status_dps * mode_rounds(mode) / ammo_cost / rate);
    let mut group_burst = group_shot / cycle + group_status + influence;

    // Enemy deaths (group fights): one enemy's health sets how often they die.
    let health = target.health.filter(|h| *h > 0.0).or(r.enemy.as_ref().map(|e| e.health).filter(|h| *h > 0.0));
    // Kills per second: the group's damage over one enemy's health, but no faster than enemies arrive.
    // An enemy only carries the statuses built up in the time it took to kill it.
    let kills = health.map(|h| (group_burst / h).min(group_n / GROUP_RESPAWN_S));
    let time_to_kill = health.map(|h| if burst > 0.0 { h / (hit_burst + status_dps) } else { f64::INFINITY });
    if group_n > 1.0 {
        let mut on_kill = 0.0;
        if let (Some(k), Some(ttk)) = (kills, time_to_kill) {
            // Gas clouds keep ticking on the others after their host dies (half the duration left on average).
            if let Some((per, alive, pps)) = tick_alive.get(&DamageType::Gas) {
                let clouds = alive.min(pps * ttk);
                on_kill += k * clouds * per * duration / 2.0 * (reach(GAS_RADIUS_M) - 1.0);
            }
            // A kill detonates the victim's Blast stacks for the group, even below 10 stacks.
            if let Some((per, _, pps)) = tick_alive.get(&DamageType::Blast) {
                if pps * fuse < BLAST_STACKS {
                    let stacks = (pps * fuse).min(pps * ttk);
                    on_kill += k * stacks * 10.0 * per * (reach(BLAST_RADIUS_M) - 1.0);
                }
            }
            approx.add(|| format!(
                "Enemy health {:.0}: {ttk:.1} s to kill one, {k:.2} kills/s in the group (at most one group every {GROUP_RESPAWN_S} s); Gas clouds linger and Blast detonates on kills",
                health.unwrap_or(0.0)
            ));
        }
        // Contagious Bond: each of the companion's kills spreads half of each status's stacks (max 100)
        // within 9 m; the group keeps them while kills come at least once per status duration.
        if r.weapon.slot == Slot::Companion && build.conditions.contagious_bond {
            let reach_bond = reach(CONTAGIOUS_BOND_RADIUS_M);
            let coverage = kills.map_or(1.0, |k| (k * duration).min(1.0));
            on_kill += bond_per_enemy * (reach_bond - 1.0) * coverage;
            approx.add(|| format!(
                "Contagious Bond: {:.0} other enemies carry half of the target's status stacks (max 100 each), {:.0}% of the time",
                reach_bond - 1.0,
                coverage * 100.0
            ));
        }
        group_burst += on_kill;
    }
    let group_sustained = group_burst * uptime;

    let explain = if quiet {
        Explain::default()
    } else {
        let mut explain = Explain::new("Burst DPS", burst)
        .child(Explain::new("Damage per shot", shot_target).with(components.iter().map(|c| c.explain.clone()).collect()))
        .child(Explain::new("Status damage per second", status_dps).with(status_explain))
        .child(
            Explain::new("Shots per second", rate)
                .detail(match locked {
                    Some(m) => format!("fire rate locked by {}", m.name),
                    None => format!("base {} × (1 + {:.3})", mode.charge_time_s.map_or(mode.fire_rate, |c| 1.0 / c), fr_bonus),
                })
                .with(mode_pools.sources_for(|s| s == Stat::FireRate)),
        );
        if let Some(e) = enemy_explain {
            explain = explain.child(e);
        }
        explain
    };

    let mut approx_dedup = Vec::new();
    for a in approx.list {
        if !approx_dedup.contains(&a) {
            approx_dedup.push(a);
        }
    }
    let coverage = if mode.coverage == Coverage::Computed && (approx.any || !mode.notes.is_empty()) {
        Coverage::Approximate
    } else {
        mode.coverage
    };

    Ok(ModeResult {
        mode: mode.name.clone(),
        mode_index: index,
        coverage,
        approximations: approx_dedup,
        fire_rate: rate,
        magazine,
        magazine_shots,
        reload_s: reload,
        per_shot_raw: finite(shot_raw, "per shot")?,
        per_shot: finite(shot_target, "per shot vs target")?,
        burst_dps_raw: finite(burst_raw, "burst DPS")?,
        burst_dps: finite(burst, "burst DPS vs target")?,
        sustained_dps: finite(sustained, "sustained DPS")?,
        per_charge,
        status_dps: finite(status_dps, "status DPS")?,
        group_dps: finite(group_burst, "group DPS")?,
        group_sustained_dps: finite(group_sustained, "group sustained DPS")?,
        procs_per_s: procs,
        status_duration_s: duration,
        free_ammo,
        viral_stacks: viral_n,
        corrosive_stacks: corr_n,
        attack_speed: r.weapon.melee.as_ref().map(|m| m.attack_speed * fr_mult),
        range_m: r.weapon.melee.as_ref().map(|m| m.range_m + mode_pools.range),
        combo_multiplier: mode.melee_role.map(|_| mode_combo),
        components,
        explain,
    })
}

/// Time to refill an Incarnon gauge of `rounds` in normal form, and the normal form's sustained DPS
/// while doing it. Charge comes from weak point hits (or any direct hit), `gain` per hit.
fn incarnon_recharge(
    r: &Resolved,
    build: &Build,
    target: &Target,
    rounds: f64,
    gain: f64,
    any_hit: bool,
    approx: &mut Notes,
) -> Option<(f64, f64)> {
    let (i, m) = r.weapon.modes.iter().enumerate().find(|(_, m)| {
        !m.incarnon_form && m.headline && m.melee_role.is_none() && !matches!(m.ammo_pool, AmmoPool::Incarnon { .. })
    })?;
    let normal = compute_mode(r, build, target, m, i).ok()?;
    if !(normal.per_shot > 0.0) {
        return None;
    }
    let shots_per_s = if normal.burst_dps > 0.0 { normal.fire_rate * normal.sustained_dps / normal.burst_dps } else { 0.0 };
    let projectiles = normal.components.first().map_or(1.0, |c| c.projectiles);
    let share = if any_hit { 1.0 } else { build.conditions.incarnon_charge_share.clamp(0.01, 1.0) };
    let hits_per_s = shots_per_s * projectiles * share;
    let t = rounds / gain / hits_per_s;
    approx.add(|| format!(
        "Sustained: {rounds:.0}-round Incarnon charge, then {t:.1} s of {} refilling the gauge ({:.1} {} hits/s, {gain} charge each)",
        m.name,
        hits_per_s,
        if any_hit { "direct" } else { "weak point" }
    ));
    Some((t, normal.sustained_dps))
}

#[allow(clippy::too_many_arguments)]
fn component(
    r: &Resolved,
    comp: &HitComponent,
    p: &Pools,
    faction: Faction,
    cond: &Conditions,
    rate: f64,
    behaviours: &[(&str, &BehaviourDef)],
    progenitor: Option<DamageType>,
    approx: &mut Notes,
) -> Result<Partial, CalcError> {
    let listed_total: f64 = comp.damage.values().sum();
    if !(listed_total > 0.0) {
        return Err(CalcError::new(ErrorCode::InvalidValue, format!("{} has no base damage", comp.name)));
    }
    if comp.crit_chance < 0.0 || comp.status_chance < 0.0 || comp.crit_mult < 1.0 {
        return Err(CalcError::new(ErrorCode::InvalidValue, format!("{} has invalid crit/status stats", comp.name)));
    }
    // Incarnon "+X base damage" scales every damage type of the attack proportionally.
    let base_scale = ((listed_total + p.base_flat) / listed_total).max(0.0);
    let mut base_damage_map: DamageMap = comp.damage.iter().map(|(t, d)| (*t, d * base_scale)).collect();
    // Progenitor bonus: an innate element worth 60% of the listed base damage.
    if let Some(t) = progenitor {
        *base_damage_map.entry(t).or_default() += listed_total * base_scale * PROGENITOR_BONUS;
    }
    let base_total: f64 = base_damage_map.values().sum();
    let mut crit0 = comp.crit_chance + p.crit_chance_base;
    let mut status0 = comp.status_chance + p.status_chance_base;
    // Linked stats use the other stat's modded value before the link itself (no feedback loop).
    let pre_cc = (crit0 * (1.0 + p.crit_chance) + p.crit_chance_flat).max(0.0);
    let pre_sc = (status0 * (1.0 + p.status_chance) + p.status_chance_flat).max(0.0);
    for (ratio, cap) in &p.status_from_crit {
        status0 += (ratio * pre_cc).min(*cap);
    }
    for (ratio, cap) in &p.crit_from_status {
        crit0 += (ratio * pre_sc).min(*cap);
    }

    // Multishot, crit and status first: Enervate and Overwhelming Attrition depend on them.
    let ms = if comp.rules.receives_multishot { comp.multishot * (1.0 + p.multishot).max(0.0) } else { 1.0 };
    let sc = (status0 * (1.0 + p.status_chance).max(0.0) + p.status_chance_flat).max(0.0);
    let modded_cc = (crit0 * (1.0 + p.crit_chance) + p.crit_chance_flat).max(0.0);
    let quiet = cond.calc_only;
    let mut crit_children = p.sources_for(|s| matches!(s, Stat::CritChance | Stat::CritChanceFlat));

    let enervate = r.arcane.and_then(|a| a.behaviour.as_deref()) == Some("enervate");
    if let Some(beh) = r.arcane.and_then(|a| a.behaviour.as_deref()) {
        if !ARCANE_BEHAVIOURS.contains(&beh) {
            approx.add(|| format!("Arcane behaviour '{beh}' not implemented; ignored"));
        }
    } else if let Some(a) = r.arcane {
        if a.modifiers.is_empty() && a.stacking.is_none() && a.combo_floor.is_none() {
            approx.add(|| format!("{} has no modelled effect; ignored", a.name));
        }
    }
    let overwhelming = behaviours.iter().find_map(|(name, b)| match b {
        BehaviourDef::OverwhelmingAttrition { bonus, max_stacks, duration_s } => Some((*name, *bonus, *max_stacks, *duration_s)),
        _ => None,
    });
    let mut oa_bonus = 0.0;
    let mut oa_explain = None;
    let cc = if enervate || overwhelming.is_some() {
        let sim = behaviours::attrition(behaviours::AttritionInput {
            crit_chance: modded_cc,
            status_chance: sc,
            hits_per_s: rate * ms,
            enervate,
            overwhelming: overwhelming.map(|(_, _, m, d)| (m, d)),
        });
        if enervate && !quiet {
            crit_children.push(
                Explain::new(r.arcane.map_or("Enervate".into(), |a| a.name.clone()), sim.avg_crit_chance - modded_cc).detail(format!(
                    "Simulated: +10% crit chance per hit, resets after 6 orange-or-better crits; average {:.2}%",
                    sim.avg_crit_chance * 100.0
                )),
            );
        }
        if let Some((name, bonus, max, dur)) = overwhelming {
            oa_bonus = bonus * sim.avg_stacks;
            oa_explain = (!quiet).then(|| Explain::new(name.to_string(), oa_bonus).detail(format!(
                "Simulated at {:.1} hits/s: average {:.2} of {max} stacks (+{:.0}% each, {dur}s), from hits that neither crit nor proc status",
                rate * ms,
                sim.avg_stacks,
                bonus * 100.0
            )));
        }
        sim.avg_crit_chance
    } else {
        modded_cc
    };

    // Puncture and Cold on the target: flat crit chance and crit damage for direct hits (not AoE).
    let direct = comp.kind != HitKind::Radial;
    let cc = cc + if direct { cond.target_crit_chance } else { 0.0 };

    // GunCO: per-status damage adds to the base damage pool, or multiplies on its own, per attack.
    let (co_factor, co_multiplies) = comp
        .rules
        .gun_co
        .as_ref()
        .map_or((1.0, false), |g| (g.factor, g.mode == GunCoMode::Multiplies));
    let co_bonus = p.gunco * co_factor;
    let co_mult = if co_multiplies { 1.0 + co_bonus } else { 1.0 };

    // 1-2. Base damage pool (Overwhelming Attrition stacks and additive GunCO join it).
    let b = (1.0 + p.base_damage + oa_bonus + if co_multiplies { 0.0 } else { co_bonus }).max(0.0);
    let modded_base = base_total * b;

    // 3. Physical mods scale their own type; 4. elements add a share of the pooled base.
    let mut damage = DamageMap::new();
    let mut innate_elements = Vec::new();
    for (t, d) in &base_damage_map {
        if t.is_physical() {
            let v = d * b * (1.0 + p.physical.get(t).copied().unwrap_or(0.0)).max(0.0);
            *damage.entry(*t).or_default() += v;
        } else if t.is_primary_element() || t.components().is_some() {
            innate_elements.push(ElementInput { ty: *t, value: d * b });
        } else {
            *damage.entry(*t).or_default() += d * b;
        }
    }
    let mod_elements: Vec<ElementInput> = p
        .elements
        .iter()
        .map(|(t, v, _)| ElementInput { ty: *t, value: v * modded_base })
        .collect();
    for (t, v) in combine(&mod_elements, &innate_elements) {
        *damage.entry(t).or_default() += v;
    }

    // 5. Quantization to multiples of modded base / 16.
    let q = modded_base / 16.0;
    if q > 0.0 {
        for v in damage.values_mut() {
            *v = (*v / q).round() * q;
        }
    }
    damage.retain(|_, v| *v > 0.0);

    // 6. Faction, and ability damage buffs (Roar, Eclipse) as their own multiplier.
    let f = 1.0 + p.faction.get(&faction).copied().unwrap_or(0.0) + p.faction_all;
    let combo = if comp.rules.combo_scaling { cond.combo_multiplier.max(1.0) } else { 1.0 };
    // Multishot-only damage bonus applies to the extra projectiles: averaged over all of them.
    let ms_bonus = if ms > 1.0 && p.multishot_damage != 0.0 { (1.0 + (ms - 1.0) * (1.0 + p.multishot_damage)) / ms } else { 1.0 };
    // Distance falloff (shotgun pellets, some hitscan) at the engagement distance; explosions hit the
    // target at their centre.
    let distance = match (&comp.falloff, comp.kind) {
        (Some(f), k) if k != HitKind::Radial => falloff_at(f, cond.engagement_m),
        _ => 1.0,
    };
    if distance < 1.0 {
        approx.add(|| format!("{}: {:.0}% damage at {:.0} m (falloff)", comp.name, distance * 100.0, cond.engagement_m));
    }
    let a = (1.0 + p.ability).max(0.0) * combo * ms_bonus * co_mult * (1.0 + p.final_damage).max(0.0) * distance;

    // 7. Crit. Expected multiplier split into its non-crit and crit parts so behaviours that act
    // on non-critical hits (Devouring Attrition) and critical headshots can be applied.
    // Threshold effects (Prelude of Might) check the build's final crit chance.
    let (mut crit_mult_extra, mut crit_damage_extra) = (0.0, 0.0);
    let mut threshold_explain = Vec::new();
    for (thr, stat, v, src) in &p.below_crit {
        let on = cc < *thr;
        if on {
            match stat {
                Stat::CritMultBase => crit_mult_extra += v,
                Stat::CritDamage => crit_damage_extra += v,
                _ => approx.add(|| format!("{src}: threshold effect on {stat:?} not modelled")),
            }
        }
        if !quiet {
            threshold_explain.push(Explain::new(src.clone(), if on { *v } else { 0.0 }).detail(format!(
                "active while crit chance < {:.0}% (now {:.1}%)",
                thr * 100.0,
                cc * 100.0
            )));
        }
    }
    let beh = r.arcane.and_then(|a| a.behaviour.as_deref());
    let mut doughty_explain = None;
    let doughty = if beh == Some("meleeDoughty") {
        let total: f64 = damage.values().sum();
        let share = damage.get(&DamageType::Puncture).copied().unwrap_or(0.0) / total.max(f64::MIN_POSITIVE);
        // +1.0x per 10% Puncture status chance (rounded to 0.1x, max 50x), on the Puncture portion only:
        // as a multiplier on the whole hit that is the bonus times the Puncture share.
        let bonus = ((10.0 * sc * share * 10.0).round() / 10.0).min(50.0);
        doughty_explain = (!quiet).then(|| Explain::new(r.arcane.map_or(String::new(), |a| a.name.clone()), bonus * share).detail(format!(
            "+{bonus:.1}x on the Puncture part ({:.0}% of the damage; Puncture status chance {:.1}%)",
            share * 100.0,
            sc * share * 100.0
        )));
        bonus * share
    } else {
        0.0
    };
    let cd = ((comp.crit_mult + p.crit_mult_base + crit_mult_extra) * (1.0 + p.crit_damage + crit_damage_extra + if direct { cond.target_crit_damage } else { 0.0 }) + p.crit_damage_flat + doughty).max(1.0)
        * (1.0 + p.crit_mult_mult).max(0.0);
    let cd = cd.max(1.0);
    let m_crit = 1.0 + cc * (cd - 1.0);
    let p_crit = cc.min(1.0);
    let crit_part = m_crit - (1.0 - p_crit);
    let mut non_crit = 1.0;
    let mut da_explain = None;
    for (name, b) in behaviours {
        if let BehaviourDef::DevouringAttrition { chance, bonus, ignored_by_bosses } = b {
            if *ignored_by_bosses && r.enemy.as_ref().is_some_and(|e| e.is_boss) {
                approx.add(|| format!("{name} doesn't work on bosses; ignored"));
                continue;
            }
            non_crit *= 1.0 + chance * bonus;
            da_explain = (!quiet).then(|| Explain::new(name.to_string(), 1.0 + chance * bonus).detail(format!(
                "{:.0}% chance for +{:.0}% on non-critical hits ({:.1}% of hits are non-critical)",
                chance * 100.0,
                bonus * 100.0,
                (1.0 - p_crit) * 100.0
            )));
        }
    }

    // Melee Duplicate: every yellow (tier 1) crit strikes a second time, with its own crit and status
    // rolls, so it counts as extra hits. Tier 1 share: CC below 100%, 2 - CC between 100% and 200%.
    let mut projectiles = ms;
    let mut dup_explain = None;
    if beh == Some("meleeDuplicate") {
        let tier1 = if cc < 1.0 { cc } else { (2.0 - cc).max(0.0) };
        projectiles *= 1.0 + tier1;
        dup_explain = (!quiet).then(|| Explain::new(r.arcane.map_or(String::new(), |a| a.name.clone()), 1.0 + tier1).detail(format!(
            "{:.0}% of hits are yellow crits and strike again (best near CC = (3·CD−4)/(2·CD−2))",
            tier1 * 100.0
        )));
    }

    // 8. Headshots: headshot ×2, critical headshots a further ×2.
    let h = if comp.rules.can_headshot { cond.headshot_share.clamp(0.0, 1.0) } else { 0.0 };
    let headshot_only = behaviours.iter().find_map(|(_, b)| match b {
        BehaviourDef::HeadshotOnlyCrits { head_crit_chance } => Some(*head_crit_chance),
        _ => None,
    });
    let parts = |c: f64| {
        let p = c.min(1.0);
        (p, 1.0 + c * (cd - 1.0) - (1.0 - p))
    };
    // Weak point crit chance (spliced riven) adds to the crit chance mods on weak point hits only.
    let head_bonus = crit0 * p.head_crit;
    let ((pb, cb), (ph, ch)) = match headshot_only {
        Some(bonus) => (parts(0.0), parts(cc + crit0 * bonus + head_bonus)),
        None => ((p_crit, crit_part), parts(cc + head_bonus)),
    };
    if let Some(bonus) = headshot_only {
        approx.add(|| format!("No crits on bodyshots; weak point hits +{:.0}% crit chance", bonus * 100.0));
    }
    let body = (1.0 - pb) * non_crit + cb;
    let head = (1.0 - ph) * non_crit + 2.0 * ch;
    let crit_hs = (1.0 - h) * body + h * 2.0 * (1.0 + p.headshot) * head;


    let explain = if quiet {
        Vec::new()
    } else {
    let mut base_children = p.sources_for(|s| s == Stat::BaseDamage);
    base_children.extend(oa_explain);
    if p.gunco != 0.0 {
        base_children.push(Explain::new("Per-status damage (GunCO)", co_bonus).detail(format!(
            "{} (factor {co_factor}); {}",
            if co_multiplies { "multiplies separately" } else { "adds to base damage" },
            if comp.rules.gun_co.is_some() { "per GunCO sheet" } else { "default (not in the sheet)" }
        )));
    }
    let mut crit_factor = Explain::new("Expected crit × headshot factor", crit_hs)
        .detail(format!("1 + CC·(CD−1) = {m_crit:.3}; headshot share {h:.2}"));
    if let Some(e) = da_explain {
        crit_factor = crit_factor.child(e);
    }
    if let Some(e) = dup_explain {
        crit_factor = crit_factor.child(e);
    }
    vec![
        Explain::new("Base damage", base_total).with(p.sources_for(|s| s == Stat::BaseDamageFlat)),
        Explain::new("Base damage multiplier", b).with(base_children),
        Explain::new("Damage per projectile after mods", damage.values().sum())
            .detail(
                damage
                    .iter()
                    .map(|(t, v)| format!("{t:?} {v:.1}"))
                    .collect::<Vec<_>>()
                    .join(", "),
            )
            .with(p.sources_for(|s| matches!(s, Stat::Element(_) | Stat::Physical(_)))),
        Explain::new("Faction multiplier", f).with(p.sources_for(|s| matches!(s, Stat::FactionDamage(_) | Stat::FactionDamageAll))),
        Explain::new("Ability damage multiplier", (1.0 + p.ability).max(0.0)).with(p.sources_for(|s| s == Stat::AbilityDamage)),
        Explain::new("Separate damage multiplier", (1.0 + p.final_damage).max(0.0)).with(p.sources_for(|s| s == Stat::FinalDamage)),
        Explain::new("Heavy attack combo multiplier", combo),
        Explain::new("Crit chance", cc).with(crit_children).with(p.sources_for(|s| s == Stat::CritChanceBase)),
        Explain::new("Crit multiplier", cd)
            .with(p.sources_for(|s| matches!(s, Stat::CritDamage | Stat::CritDamageFlat | Stat::CritMultBase)))
            .with(threshold_explain)
            .with(doughty_explain.into_iter().collect()),
        crit_factor,
        Explain::new("Status chance", sc).with(p.sources_for(|s| matches!(s, Stat::StatusChance | Stat::StatusChanceFlat))),
        Explain::new("Multishot", ms).with(p.sources_for(|s| s == Stat::Multishot)),
    ]
    };

    let mut elem_bonus: BTreeMap<DamageType, f64> = BTreeMap::new();
    for (t, v, _) in &p.elements {
        *elem_bonus.entry(*t).or_default() += v;
    }
    Ok(Partial {
        name: comp.name.clone(),
        kind: comp.kind,
        radius: comp.falloff.as_ref().map(|f| f.end_m),
        elem_bonus,
        forced: comp.forced_procs.clone(),
        falloff: comp.falloff.clone(),
        punch_through: comp.punch_through + p.punch_through,
        status_damage: p.status_damage,
        damage,
        projectiles,
        crit_chance: cc,
        arsenal_crit_chance: modded_cc,
        crit_mult: cd,
        status_chance: sc,
        crit_hs,
        faction: f,
        ability: a,
        modded_base,
        explain,
    })
}
