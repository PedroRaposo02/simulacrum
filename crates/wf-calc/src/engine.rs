use crate::behaviours;
use crate::elements::{combine, ElementInput};
use crate::types::*;
use std::collections::BTreeMap;
use wf_data::*;

const ARMOR_CAP: f64 = 2700.0;
const MAX_DR: f64 = 0.9;
const STATUS_DURATION_S: f64 = 6.0;

/// DoT statuses: (type, fraction of modded base damage per tick, ticks per proc).
/// Approximate values from the wiki's status table; kept here until moved to overrides.
const DOTS: [(DamageType, f64, f64); 5] = [
    (DamageType::Slash, 0.35, 6.0),
    (DamageType::Heat, 0.5, 6.0),
    (DamageType::Toxin, 0.5, 6.0),
    (DamageType::Gas, 0.5, 6.0),
    (DamageType::Electricity, 0.5, 6.0),
];

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
    sources: Vec<(String, Stat, f64)>,
}

impl Pools {
    fn add(&mut self, m: &Modifier, scale: f64) {
        let v = m.value * scale;
        if m.condition == Condition::CritChanceBelow {
            self.below_crit.push((m.threshold.unwrap_or(0.0), m.stat, m.value, m.source.clone()));
            return;
        }
        match m.stat {
            Stat::BaseDamage => self.base_damage += v,
            Stat::Physical(t) => *self.physical.entry(t).or_default() += v,
            Stat::Element(t) => self.elements.push((t, v, m.source.clone())),
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
        }
        self.sources.push((m.source.clone(), m.stat, v));
    }

    fn sources_for(&self, pred: impl Fn(Stat) -> bool) -> Vec<Explain> {
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
        Condition::OnHeadshot | Condition::OnHeadshotKill if !c.headshot_effects => 0.0,
        _ => c.conditional_uptime.clamp(0.0, 1.0) * stacks,
    };
    let per = match m.per {
        None => 1.0,
        Some(PerCount::StatusType) => c.status_types.max(0.0),
        Some(PerCount::ComboMultiplier) => (c.combo_multiplier - 1.0).max(0.0),
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
        target: r.enemy.as_ref().map(|e| e.name.clone()).unwrap_or_else(|| "Raw (no enemy)".into()),
        modes,
        failed_modes,
        warnings: r.warnings,
    }
}

fn all_modifiers<'a>(r: &'a Resolved, build: &'a Build, mode: &'a AttackMode) -> impl Iterator<Item = &'a Modifier> {
    r.weapon
        .innate
        .iter()
        .chain(r.mods.iter().flat_map(|m| m.modifiers.iter()))
        .chain(r.arcane.iter().flat_map(|a| a.modifiers.iter()))
        .chain(r.evolutions.iter().filter(move |e| form_ok(e.forms, mode)).flat_map(|e| e.modifiers.iter()))
        .chain(build.riven.iter())
        .chain(build.buffs.iter())
}

fn finite(v: f64, what: &str) -> Result<f64, CalcError> {
    if v.is_finite() {
        Ok(v)
    } else {
        Err(CalcError::new(ErrorCode::NonFinite, format!("{what} is not finite")))
    }
}

struct Partial {
    name: String,
    damage: DamageMap,
    projectiles: f64,
    crit_chance: f64,
    crit_mult: f64,
    status_chance: f64,
    crit_hs: f64,
    faction: f64,
    ability: f64,
    modded_base: f64,
    explain: Vec<Explain>,
}

fn compute_mode(
    r: &Resolved,
    build: &Build,
    target: &Target,
    mode: &AttackMode,
    index: usize,
) -> Result<ModeResult, CalcError> {
    let mut approx: Vec<String> = mode.notes.clone();
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

    let mut partials = Vec::new();
    let mode_combo = mode.components.first().map_or(build.conditions.combo_multiplier, |c| combo_for(&build.conditions, &c.rules));
    let mode_cond = with_combo(&build.conditions, mode_combo);
    let mut mode_pools = Pools::default();
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
            approx.push("Charge timing simplified: cycle = max(charge time, 1/fire rate) ÷ fire-rate bonus".into());
            fr_mult / base_cycle
        }
        _ if mode.melee_role == Some(MeleeRole::Heavy) => mode.fire_rate * fr_mult * (1.0 + mode_pools.wind_up).max(0.05),
        _ => mode.fire_rate * fr_mult,
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
        let cond = with_combo(&build.conditions, combo_for(&build.conditions, &comp.rules));
        let mut p = Pools::default();
        for m in all_modifiers(r, build, mode).filter(|m| filter_ok(m.applies_to, comp)) {
            p.add(m, condition_scale(m, &cond));
        }
        partials.push(component(r, build, comp, &p, faction, &cond, rate, &behaviours, &mut approx)?);
    }

    let magazine = mode.magazine.map(|m| ((m as f64) * (1.0 + mode_pools.magazine)).round().max(1.0) as u32);
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
            let eff_armor = e.armor.min(ARMOR_CAP) * (1.0 - s_heat) * (1.0 - s_corr) * (1.0 - target.armor_strip.clamp(0.0, 1.0));
            let dr = MAX_DR * (eff_armor / ARMOR_CAP).sqrt();
            let v = if viral_n >= 1.0 { 2.0 + 0.25 * (viral_n.min(10.0) - 1.0) } else { 1.0 + viral_n };
            if viral_n > 0.0 && viral_n < 1.0 {
                approx.push("Viral below one steady-state stack: uptime interpolated linearly".into());
            }
            if e.health_modifiers.is_empty() {
                approx.push(format!("{}: health-class damage modifiers not set; armor and status only", e.name));
            }
            let ex = Explain::new(format!("Enemy: {}", e.name), (1.0 - dr) * v).with(vec![
                Explain::new("Armor (capped)", e.armor.min(ARMOR_CAP)),
                Explain::new("Corrosive strip", s_corr).detail(format!(
                    "{corr_n:.2} stacks ({own_corr:.2} from this weapon{})",
                    target.corrosive_stacks.map(|x| format!(", {x:.0} outsourced")).unwrap_or_default()
                )),
                Explain::new("Heat strip", s_heat),
                Explain::new("External strip", target.armor_strip),
                Explain::new("Effective armor", eff_armor),
                Explain::new("Damage reduction", dr).detail("0.9·√(armor/2700)"),
                Explain::new("Viral multiplier", v).detail(format!(
                    "{viral_n:.2} stacks ({own_viral:.2} from this weapon{})",
                    target.viral_stacks.map(|x| format!(", {x:.0} outsourced")).unwrap_or_default()
                )),
            ]);
            (dr, v, Some(ex))
        }
        None => (0.0, 1.0, None),
    };

    let mut components = Vec::new();
    let (mut shot_raw, mut shot_target, mut status_dps) = (0.0, 0.0, 0.0);
    for p in partials {
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
        let total: f64 = p.damage.values().sum();
        for (t, frac, ticks) in DOTS {
            let share = p.damage.get(&t).copied().unwrap_or(0.0) / total.max(f64::MIN_POSITIVE);
            let pps = p.status_chance * p.projectiles * rate * share;
            let tick = p.modded_base * frac * p.faction * p.faction * (1.0 + p.crit_chance * (p.crit_mult - 1.0));
            let armor = if t == DamageType::Slash { 1.0 } else { 1.0 - dr };
            status_dps += pps * ticks * tick * armor * viral_mult * p.ability;
        }
        shot_raw += raw_hit * p.projectiles;
        shot_target += target_hit * p.projectiles;
        let mut ex = Explain::new(format!("{} per shot", p.name), target_hit * p.projectiles).with(p.explain);
        ex = ex.child(Explain::new("Projectiles", p.projectiles));
        components.push(ComponentResult {
            name: p.name,
            damage: p.damage,
            per_projectile_raw: finite(raw_hit, "raw hit")?,
            per_projectile_target: finite(target_hit, "hit vs target")?,
            projectiles: p.projectiles,
            crit_chance: p.crit_chance,
            crit_mult: p.crit_mult,
            status_chance: p.status_chance,
            explain: ex,
        });
    }
    if !status_dps.is_nan() && status_dps > 0.0 {
        approx.push("Status DPS uses approximate DoT tick values".into());
    }

    let burst_raw = shot_raw * rate;
    let burst = shot_target * rate;
    let (sustained, per_charge) = match (&mode.ammo_pool, magazine) {
        (AmmoPool::Incarnon { rounds: Some(n), recharge_s }, _) => {
            let n = *n as f64;
            if recharge_s.is_none() {
                approx.push("Incarnon recharge depends on weakpoint hits: sustained DPS shown as burst; see damage per charge".into());
            }
            let t = recharge_s.unwrap_or(0.0);
            (shot_target * n / (n / rate + t), Some(shot_target * n))
        }
        (AmmoPool::Incarnon { .. }, _) => {
            approx.push("Incarnon ammo pool unknown: sustained DPS shown as burst".into());
            (burst, None)
        }
        (_, Some(m)) if mode.trigger != Trigger::Held => {
            let m = m as f64;
            (shot_target * m / (m / rate + reload), None)
        }
        _ => (burst, None),
    };

    let mut explain = Explain::new("Burst DPS", burst)
        .child(Explain::new("Damage per shot", shot_target).with(components.iter().map(|c| c.explain.clone()).collect()))
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

    let mut approx_dedup = Vec::new();
    for a in approx {
        if !approx_dedup.contains(&a) {
            approx_dedup.push(a);
        }
    }
    let coverage = if mode.coverage == Coverage::Computed && !approx_dedup.is_empty() {
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
        reload_s: reload,
        per_shot_raw: finite(shot_raw, "per shot")?,
        per_shot: finite(shot_target, "per shot vs target")?,
        burst_dps_raw: finite(burst_raw, "burst DPS")?,
        burst_dps: finite(burst, "burst DPS vs target")?,
        sustained_dps: finite(sustained, "sustained DPS")?,
        per_charge,
        status_dps: finite(status_dps, "status DPS")?,
        procs_per_s: procs,
        viral_stacks: viral_n,
        corrosive_stacks: corr_n,
        attack_speed: r.weapon.melee.as_ref().map(|m| m.attack_speed * fr_mult),
        range_m: r.weapon.melee.as_ref().map(|m| m.range_m + mode_pools.range),
        combo_multiplier: mode.melee_role.map(|_| mode_combo),
        components,
        explain,
    })
}

#[allow(clippy::too_many_arguments)]
fn component(
    r: &Resolved,
    build: &Build,
    comp: &HitComponent,
    p: &Pools,
    faction: Faction,
    cond: &Conditions,
    rate: f64,
    behaviours: &[(&str, &BehaviourDef)],
    approx: &mut Vec<String>,
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
    let base_damage_map: DamageMap = comp.damage.iter().map(|(t, d)| (*t, d * base_scale)).collect();
    let base_total = listed_total * base_scale;
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
    let mut crit_children = p.sources_for(|s| matches!(s, Stat::CritChance | Stat::CritChanceFlat));

    let enervate = r.arcane.and_then(|a| a.behaviour.as_deref()) == Some("enervate");
    if let Some(beh) = r.arcane.and_then(|a| a.behaviour.as_deref()) {
        if beh != "enervate" {
            approx.push(format!("Arcane behaviour '{beh}' not implemented; ignored"));
        }
    } else if let Some(a) = r.arcane {
        if a.modifiers.is_empty() {
            approx.push(format!("{} has no modelled effect; ignored", a.name));
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
        if enervate {
            crit_children.push(
                Explain::new(r.arcane.map_or("Enervate".into(), |a| a.name.clone()), sim.avg_crit_chance - modded_cc).detail(format!(
                    "Simulated: +10% crit chance per hit, resets after 6 orange-or-better crits; average {:.2}%",
                    sim.avg_crit_chance * 100.0
                )),
            );
        }
        if let Some((name, bonus, max, dur)) = overwhelming {
            oa_bonus = bonus * sim.avg_stacks;
            oa_explain = Some(Explain::new(name.to_string(), oa_bonus).detail(format!(
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

    // 1-2. Base damage pool (Overwhelming Attrition stacks join it additively).
    let b = (1.0 + p.base_damage + oa_bonus).max(0.0);
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
    let a = (1.0 + p.ability).max(0.0) * combo * ms_bonus;

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
                _ => approx.push(format!("{src}: threshold effect on {stat:?} not modelled")),
            }
        }
        threshold_explain.push(Explain::new(src.clone(), if on { *v } else { 0.0 }).detail(format!(
            "active while crit chance < {:.0}% (now {:.1}%)",
            thr * 100.0,
            cc * 100.0
        )));
    }
    let cd = ((comp.crit_mult + p.crit_mult_base + crit_mult_extra) * (1.0 + p.crit_damage + crit_damage_extra) + p.crit_damage_flat).max(1.0);
    let m_crit = 1.0 + cc * (cd - 1.0);
    let p_crit = cc.min(1.0);
    let crit_part = m_crit - (1.0 - p_crit);
    let mut non_crit = 1.0;
    let mut da_explain = None;
    for (name, b) in behaviours {
        if let BehaviourDef::DevouringAttrition { chance, bonus, ignored_by_bosses } = b {
            if *ignored_by_bosses && r.enemy.as_ref().is_some_and(|e| e.is_boss) {
                approx.push(format!("{name} doesn't work on bosses; ignored"));
                continue;
            }
            non_crit *= 1.0 + chance * bonus;
            da_explain = Some(Explain::new(name.to_string(), 1.0 + chance * bonus).detail(format!(
                "{:.0}% chance for +{:.0}% on non-critical hits ({:.1}% of hits are non-critical)",
                chance * 100.0,
                bonus * 100.0,
                (1.0 - p_crit) * 100.0
            )));
        }
    }

    // 8. Headshots: headshot ×2, critical headshots a further ×2.
    let h = if comp.rules.can_headshot { build.conditions.headshot_share.clamp(0.0, 1.0) } else { 0.0 };
    let body = (1.0 - p_crit) * non_crit + crit_part;
    let head = (1.0 - p_crit) * non_crit + 2.0 * crit_part;
    let crit_hs = (1.0 - h) * body + h * 2.0 * (1.0 + p.headshot) * head;

    // 9. GunCO behaviour hook.
    if comp.rules.gun_co.is_some() {
        approx.push("Galvanized Shot / GunCO interaction not modelled yet".into());
    }

    let mut base_children = p.sources_for(|s| s == Stat::BaseDamage);
    base_children.extend(oa_explain);
    let mut crit_factor = Explain::new("Expected crit × headshot factor", crit_hs)
        .detail(format!("1 + CC·(CD−1) = {m_crit:.3}; headshot share {h:.2}"));
    if let Some(e) = da_explain {
        crit_factor = crit_factor.child(e);
    }
    let explain = vec![
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
        Explain::new("Heavy attack combo multiplier", combo),
        Explain::new("Crit chance", cc).with(crit_children).with(p.sources_for(|s| s == Stat::CritChanceBase)),
        Explain::new("Crit multiplier", cd)
            .with(p.sources_for(|s| matches!(s, Stat::CritDamage | Stat::CritDamageFlat | Stat::CritMultBase)))
            .with(threshold_explain),
        crit_factor,
        Explain::new("Status chance", sc).with(p.sources_for(|s| matches!(s, Stat::StatusChance | Stat::StatusChanceFlat))),
        Explain::new("Multishot", ms).with(p.sources_for(|s| s == Stat::Multishot)),
    ];

    Ok(Partial {
        name: comp.name.clone(),
        damage,
        projectiles: ms,
        crit_chance: cc,
        crit_mult: cd,
        status_chance: sc,
        crit_hs,
        faction: f,
        ability: a,
        modded_base,
        explain,
    })
}
