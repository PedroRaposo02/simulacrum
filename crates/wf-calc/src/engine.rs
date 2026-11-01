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
    crit_damage: f64,
    crit_damage_flat: f64,
    status_chance: f64,
    fire_rate: f64,
    magazine: f64,
    reload: f64,
    faction: BTreeMap<Faction, f64>,
    headshot: f64,
    status_duration: f64,
    sources: Vec<(String, Stat, f64)>,
}

impl Pools {
    fn add(&mut self, m: &Modifier, scale: f64) {
        let v = m.value * scale;
        match m.stat {
            Stat::BaseDamage => self.base_damage += v,
            Stat::Physical(t) => *self.physical.entry(t).or_default() += v,
            Stat::Element(t) => self.elements.push((t, v, m.source.clone())),
            Stat::Multishot => self.multishot += v,
            Stat::CritChance => self.crit_chance += v,
            Stat::CritChanceFlat => self.crit_chance_flat += v,
            Stat::CritDamage => self.crit_damage += v,
            Stat::CritDamageFlat => self.crit_damage_flat += v,
            Stat::StatusChance => self.status_chance += v,
            Stat::FireRate => self.fire_rate += v,
            Stat::Magazine => self.magazine += v,
            Stat::ReloadSpeed => self.reload += v,
            Stat::FactionDamage(f) => *self.faction.entry(f).or_default() += v,
            Stat::HeadshotDamage => self.headshot += v,
            Stat::StatusDuration => self.status_duration += v,
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

struct Resolved<'a> {
    weapon: &'a Weapon,
    mods: Vec<&'a Mod>,
    arcane: Option<&'a Arcane>,
    enemy: Option<EnemyProfile>,
    warnings: Vec<String>,
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
    let enemy = match (&target.profile, &target.enemy) {
        (Some(p), _) => Some(p.clone()),
        (None, Some(id)) => Some(
            data.enemy(id)
                .cloned()
                .ok_or_else(|| CalcError::new(ErrorCode::UnknownEnemy, format!("no enemy preset '{id}'")))?,
        ),
        _ => None,
    };
    Ok(Resolved { weapon, mods, arcane, enemy, warnings })
}

fn condition_scale(m: &Modifier, c: &Conditions) -> f64 {
    let stacks = m.max_stacks.max(1) as f64;
    match m.condition {
        Condition::Always => 1.0,
        _ => c.conditional_uptime.clamp(0.0, 1.0) * stacks,
    }
}

fn filter_ok(f: ComponentFilter, kind: HitKind) -> bool {
    match f {
        ComponentFilter::All => true,
        ComponentFilter::DirectOnly => kind != HitKind::Radial,
        ComponentFilter::RadialOnly => kind == HitKind::Radial,
    }
}

pub fn compute(data: &GameData, build: &Build, target: &Target) -> Result<BuildResult, CalcError> {
    let r = resolve(data, build, target)?;
    let mut modes = Vec::new();
    let mut failed_modes = Vec::new();
    for (i, mode) in r.weapon.modes.iter().enumerate() {
        match compute_mode(&r, build, target, mode, i) {
            Ok(m) => modes.push(m),
            Err(error) => failed_modes.push(ModeFailure { mode: mode.name.clone(), mode_index: i, error }),
        }
    }
    Ok(BuildResult {
        weapon: r.weapon.name.clone(),
        weapon_id: r.weapon.id.clone(),
        target: r.enemy.as_ref().map(|e| e.name.clone()).unwrap_or_else(|| "Raw (no enemy)".into()),
        modes,
        failed_modes,
        warnings: r.warnings,
    })
}

fn all_modifiers<'a>(r: &'a Resolved, build: &'a Build) -> impl Iterator<Item = &'a Modifier> {
    r.weapon
        .innate
        .iter()
        .chain(r.mods.iter().flat_map(|m| m.modifiers.iter()))
        .chain(r.arcane.iter().flat_map(|a| a.modifiers.iter()))
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
    let mut mode_pools = Pools::default();
    for m in all_modifiers(r, build) {
        mode_pools.add(m, condition_scale(m, &build.conditions));
    }

    for comp in &mode.components {
        let mut p = Pools::default();
        for m in all_modifiers(r, build).filter(|m| filter_ok(m.applies_to, comp.kind)) {
            p.add(m, condition_scale(m, &build.conditions));
        }
        partials.push(component(r, build, comp, &p, faction, &mut approx)?);
    }

    // Rate, magazine, reload.
    let fr_bonus = if r.weapon.class == WeaponClass::Bow { mode_pools.fire_rate * 2.0 } else { mode_pools.fire_rate };
    let fr_mult = (1.0 + fr_bonus).max(0.05);
    let rate = match mode.charge_time_s {
        Some(ct) if ct > 0.0 => {
            let base_cycle = if mode.fire_rate > 0.0 { ct.max(1.0 / mode.fire_rate) } else { ct };
            approx.push("Charge timing simplified: cycle = max(charge time, 1/fire rate) ÷ fire-rate bonus".into());
            fr_mult / base_cycle
        }
        _ => mode.fire_rate * fr_mult,
    };
    if !(rate > 0.0) {
        return Err(CalcError::new(ErrorCode::InvalidValue, format!("{} has no fire rate", mode.name)));
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
    let viral_n = target.viral_stacks.unwrap_or_else(|| stacks(DamageType::Viral));
    let corr_n = target.corrosive_stacks.unwrap_or_else(|| stacks(DamageType::Corrosive));
    let heat_on = target.heat_active.unwrap_or(stacks(DamageType::Heat) >= 1.0);

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
                Explain::new("Corrosive strip", s_corr).detail(format!("{corr_n:.2} stacks")),
                Explain::new("Heat strip", s_heat),
                Explain::new("External strip", target.armor_strip),
                Explain::new("Effective armor", eff_armor),
                Explain::new("Damage reduction", dr).detail("0.9·√(armor/2700)"),
                Explain::new("Viral multiplier", v).detail(format!("{viral_n:.2} stacks")),
            ]);
            (dr, v, Some(ex))
        }
        None => (0.0, 1.0, None),
    };

    let mut components = Vec::new();
    let (mut shot_raw, mut shot_target, mut status_dps) = (0.0, 0.0, 0.0);
    for p in partials {
        let raw_hit: f64 = p.damage.values().sum::<f64>() * p.faction * p.crit_hs;
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
            * viral_mult;
        let total: f64 = p.damage.values().sum();
        for (t, frac, ticks) in DOTS {
            let share = p.damage.get(&t).copied().unwrap_or(0.0) / total.max(f64::MIN_POSITIVE);
            let pps = p.status_chance * p.projectiles * rate * share;
            let tick = p.modded_base * frac * p.faction * p.faction * (1.0 + p.crit_chance * (p.crit_mult - 1.0));
            let armor = if t == DamageType::Slash { 1.0 } else { 1.0 - dr };
            status_dps += pps * ticks * tick * armor * viral_mult;
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
                .detail(format!("base {} × (1 + {:.3})", mode.charge_time_s.map_or(mode.fire_rate, |c| 1.0 / c), fr_bonus))
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
        components,
        explain,
    })
}

fn component(
    r: &Resolved,
    build: &Build,
    comp: &HitComponent,
    p: &Pools,
    faction: Faction,
    approx: &mut Vec<String>,
) -> Result<Partial, CalcError> {
    let base_total: f64 = comp.damage.values().sum();
    if !(base_total > 0.0) {
        return Err(CalcError::new(ErrorCode::InvalidValue, format!("{} has no base damage", comp.name)));
    }
    if comp.crit_chance < 0.0 || comp.status_chance < 0.0 || comp.crit_mult < 1.0 {
        return Err(CalcError::new(ErrorCode::InvalidValue, format!("{} has invalid crit/status stats", comp.name)));
    }

    // 1-2. Base damage pool.
    let b = (1.0 + p.base_damage).max(0.0);
    let modded_base = base_total * b;

    // 3. Physical mods scale their own type; 4. elements add a share of the pooled base.
    let mut damage = DamageMap::new();
    let mut innate_elements = Vec::new();
    for (t, d) in &comp.damage {
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

    // 6. Faction.
    let f = 1.0 + p.faction.get(&faction).copied().unwrap_or(0.0);

    // 7. Crit, with behaviours (Enervate) adding flat crit chance.
    let mut cc = comp.crit_chance * (1.0 + p.crit_chance) + p.crit_chance_flat;
    let mut crit_children = p.sources_for(|s| matches!(s, Stat::CritChance | Stat::CritChanceFlat));
    if let Some(beh) = r.arcane.and_then(|a| a.behaviour.as_deref()) {
        match behaviours::apply(beh, cc) {
            Some(eff) => {
                cc += eff.crit_chance_flat;
                crit_children.push(Explain::new(r.arcane.unwrap().name.clone(), eff.crit_chance_flat).detail(eff.detail));
            }
            None => approx.push(format!("Arcane behaviour '{beh}' not implemented; ignored")),
        }
    } else if let Some(a) = r.arcane {
        if a.modifiers.is_empty() {
            approx.push(format!("{} has no modelled effect; ignored", a.name));
        }
    }
    let cc = cc.max(0.0);
    let cd = (comp.crit_mult * (1.0 + p.crit_damage) + p.crit_damage_flat).max(1.0);
    let m_crit = 1.0 + cc * (cd - 1.0);

    // 8. Headshots: headshot ×2, critical headshots a further ×2.
    let h = if comp.rules.can_headshot { build.conditions.headshot_share.clamp(0.0, 1.0) } else { 0.0 };
    let p_crit = cc.min(1.0);
    let hs_crit = 2.0 * m_crit - (1.0 - p_crit);
    let crit_hs = (1.0 - h) * m_crit + h * 2.0 * (1.0 + p.headshot) * hs_crit;

    // 9. GunCO behaviour hook.
    if comp.rules.gun_co.is_some() {
        approx.push("Galvanized Shot / GunCO interaction not modelled yet".into());
    }

    let ms = if comp.rules.receives_multishot { comp.multishot * (1.0 + p.multishot).max(0.0) } else { 1.0 };
    let sc = comp.status_chance * (1.0 + p.status_chance).max(0.0);

    let explain = vec![
        Explain::new("Base damage", base_total),
        Explain::new("Base damage multiplier", b)
            .with(p.sources_for(|s| s == Stat::BaseDamage)),
        Explain::new("Damage per projectile after mods", damage.values().sum())
            .detail(
                damage
                    .iter()
                    .map(|(t, v)| format!("{t:?} {v:.1}"))
                    .collect::<Vec<_>>()
                    .join(", "),
            )
            .with(p.sources_for(|s| matches!(s, Stat::Element(_) | Stat::Physical(_)))),
        Explain::new("Faction multiplier", f),
        Explain::new("Crit chance", cc).with(crit_children),
        Explain::new("Crit multiplier", cd).with(p.sources_for(|s| matches!(s, Stat::CritDamage | Stat::CritDamageFlat))),
        Explain::new("Expected crit × headshot factor", crit_hs)
            .detail(format!("1 + CC·(CD−1) = {m_crit:.3}; headshot share {h:.2}")),
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
        modded_base,
        explain,
    })
}
