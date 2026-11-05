//! Build optimizer: greedy fill, then best-improvement local search over mod swaps and element
//! order, then arcane choice, then an optional theoretical riven searched jointly with the mods.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use wf_calc::{evaluate, resolve_enemy, Build, CalcError, ErrorCode, Resolved, Target};
use wf_data::{Arcane, DamageType, EnemyProfile, Faction, GameData, Mod, Modifier, RivenType, Stat, Weapon};

const NORMAL_SLOTS: usize = 8;
const MAX_PASSES: usize = 40;
/// Arcane x evolution combinations that get a full local search after the greedy screening.
const STRUCTURE_FINALISTS: usize = 3;
/// Best structures the riven search is run on.
const RIVEN_STRUCTURES: usize = 2;
/// Upper bound on evolution combinations searched.
const MAX_EVOLUTION_COMBOS: usize = 64;

#[derive(Clone)]
struct Structure<'a> {
    score: f64,
    progenitor: Option<wf_data::DamageType>,
    arcane: Option<&'a Arcane>,
    evolutions: Vec<&'a wf_data::Evolution>,
    mods: Vec<&'a Mod>,
}

/// One option per tier. Options with no damage effect are interchangeable, so each tier keeps
/// one of them plus every option that does something; the product is capped.
/// Evolution combinations to search. A tier with one of `fixed` keeps it; the other tiers are searched.
fn evolution_combos<'a>(weapon: &'a Weapon, enabled: bool, faction: Faction, allow_faction: bool, fixed: &[String]) -> Vec<Vec<&'a wf_data::Evolution>> {
    if weapon.evolutions.is_empty() || (!enabled && fixed.is_empty()) {
        return vec![vec![]];
    }
    let effective = |e: &wf_data::Evolution| e.behaviour.is_some() || e.modifiers.iter().any(|m| stat_matters(m.stat, faction, allow_faction));
    let mut combos: Vec<Vec<&wf_data::Evolution>> = vec![vec![]];
    for tier in weapon.evolutions.iter().filter(|t| !t.options.is_empty()) {
        let pinned: Vec<&wf_data::Evolution> = tier.options.iter().filter(|e| fixed.iter().any(|n| n.eq_ignore_ascii_case(&e.name))).collect();
        let opts: Vec<&wf_data::Evolution> = if !pinned.is_empty() {
            pinned
        } else if !enabled {
            continue;
        } else {
            // Every option with an effect, plus one without (they're interchangeable).
            let mut o: Vec<&wf_data::Evolution> = tier.options.iter().filter(|e| effective(e)).collect();
            if let Some(inert) = tier.options.iter().find(|e| !effective(e)) {
                o.push(inert);
            }
            o
        };
        let mut next = Vec::new();
        for c in &combos {
            for o in &opts {
                if next.len() >= MAX_EVOLUTION_COMBOS {
                    break;
                }
                let mut n = c.clone();
                n.push(*o);
                next.push(n);
            }
        }
        combos = next;
    }
    combos
}

/// What the optimizer maximizes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Objective {
    /// Sustained DPS where fire rate above a comfortable rate counts for nothing, so slots go to
    /// damage and status instead of runaway fire rate. Melee: burst DPS.
    #[default]
    Balanced,
    /// Damage per second while firing.
    Burst,
    /// Damage per second including reloads.
    Sustained,
    /// Damage of one shot (one combo for melee).
    PerShot,
    /// Damage of a full Incarnon charge, or of one magazine for normal weapons. Fire rate adds
    /// nothing here, so it favours damage stats.
    PerCharge,
    /// Balanced, on the damage dealt to a whole group of enemies (Conditions::group_size): radial
    /// hits, melee swings with follow-through, Gas, Electricity, Blast and Melee Influence spread.
    Group,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OptimizeOptions {
    pub objective: Objective,
    /// Comfort for guns: fire rate may rise at most this much over the weapon's unmodded rate
    /// (1.5 = +150%); builds above it rank below builds within it.
    pub max_fire_rate_bonus: Option<f64>,
    /// Slot the explosion-radius mod (Primed Firestorm…) on weapons whose main attack is a
    /// sizeable explosion.
    pub explosion_mod: bool,
    /// Builds below this crit chance rank below builds that reach it (Tenacious Bond needs 50%
    /// on the companion's weapon).
    pub min_crit_chance: Option<f64>,
    /// Attack mode to optimize; None picks the mode with the highest unmodded burst DPS.
    pub mode: Option<usize>,
    pub riven: bool,
    pub arcane: bool,
    /// Riven roll position in [0, 1] between the minimum and maximum roll.
    pub riven_roll: f64,
    /// Comfort: builds below this modded attack speed / fire rate always rank below builds above it.
    pub min_attack_speed: Option<f64>,
    /// Comfort: after optimizing, swap in a range mod if it costs at most this fraction of DPS.
    pub range_tolerance: Option<f64>,
    /// Realistic mode: respect mod capacity and slot polarities. None = theoretical (anything fits).
    pub capacity: Option<CapacityOptions>,
    /// Allow riven stats that only come from splicing.
    pub spliced_riven: bool,
    /// Grade mode: optimize the other mods around this exact riven (its modifiers as rolled).
    pub fixed_riven: Vec<Modifier>,
    /// Allow faction damage mods (Bane, Expel, Smite…) and riven faction stats. Off by default.
    pub allow_faction: bool,
    /// Search Incarnon evolutions (one per tier) along with the mods.
    pub evolutions: bool,
    /// Kuva / Tenet progenitor element; None = search every element.
    pub progenitor: Option<wf_data::DamageType>,
    /// Keep these Incarnon evolutions (by name); tiers without one are still searched.
    pub fixed_evolutions: Vec<String>,
    /// Keep this arcane (by name) instead of searching arcanes.
    pub fixed_arcane: Option<String>,
}

impl Default for OptimizeOptions {
    fn default() -> Self {
        Self {
            mode: None,
            riven: false,
            arcane: true,
            riven_roll: 1.0,
            min_attack_speed: None,
            range_tolerance: None,
            capacity: None,
            progenitor: None,
            fixed_evolutions: vec![],
            fixed_arcane: None,
            spliced_riven: true,
            objective: Objective::Balanced,
            max_fire_rate_bonus: None,
            explosion_mod: true,
            min_crit_chance: None,
            fixed_riven: vec![],
            allow_faction: false,
            evolutions: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CapacityOptions {
    /// Total capacity: 60 with a reactor/catalyst (plus any stance bonus), 30 without.
    pub capacity: f64,
    /// Polarity of the 8 normal slots then the exilus slot (None = unpolarized).
    pub polarities: Vec<Option<String>>,
    /// Capacity a riven takes (rank 8 riven in a matching slot is about 9).
    pub riven_drain: f64,
}

impl Default for CapacityOptions {
    fn default() -> Self {
        Self { capacity: 60.0, polarities: vec![None; NORMAL_SLOTS + 1], riven_drain: 9.0 }
    }
}

/// Drain of a mod at max rank in a slot: matching polarity halves it (rounded up), a
/// mismatched polarized slot adds 25% (rounded).
pub fn slot_drain(m: &Mod, slot: Option<&str>) -> f64 {
    let d = (m.base_drain + m.max_rank as i32).max(0) as f64;
    match slot {
        None => d,
        Some(p) if p.eq_ignore_ascii_case(&m.polarity) => (d / 2.0).ceil(),
        Some(_) => (d * 1.25).round(),
    }
}

/// Minimum total drain for a set of mods given slot polarities (greedy: biggest mods take matching
/// slots, then unpolarized ones; mismatched slots go to whatever is left).
pub fn total_drain(mods: &[&Mod], normal_slots: usize, cap: &CapacityOptions) -> f64 {
    let mut slots: Vec<Option<&str>> = cap.polarities.iter().take(NORMAL_SLOTS).map(|p| p.as_deref()).collect();
    slots.resize(NORMAL_SLOTS, None);
    // A riven takes one normal slot: prefer giving it an unpolarized one.
    if normal_slots < NORMAL_SLOTS {
        let i = slots.iter().position(|s| s.is_none()).unwrap_or(slots.len() - 1);
        slots.remove(i);
    }
    let (normal, exilus): (&[&Mod], Option<&Mod>) =
        if mods.len() > normal_slots { (&mods[..normal_slots], mods.get(normal_slots).copied()) } else { (mods, None) };
    let mut order: Vec<&Mod> = normal.to_vec();
    order.sort_by_key(|m| std::cmp::Reverse(m.base_drain + m.max_rank as i32));
    let mut free = vec![true; slots.len()];
    let mut total = 0.0;
    for m in order {
        let pick = (0..slots.len())
            .filter(|&i| free[i])
            .min_by(|&a, &b| slot_drain(m, slots[a]).total_cmp(&slot_drain(m, slots[b])))
            .unwrap_or(0);
        if let Some(f) = free.get_mut(pick) {
            *f = false;
        }
        total += slot_drain(m, slots.get(pick).copied().flatten());
    }
    if let Some(e) = exilus {
        total += slot_drain(e, cap.polarities.get(NORMAL_SLOTS).and_then(|p| p.as_deref()));
    }
    if normal_slots < NORMAL_SLOTS {
        total += cap.riven_drain;
    }
    total
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RivenPick {
    pub key: String,
    pub label: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marginal {
    pub label: String,
    pub kind: String,
    /// Burst DPS lost when this piece is removed, as a fraction of the build's DPS.
    pub loss: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeResult {
    pub weapon_id: String,
    pub weapon: String,
    pub mode: String,
    pub mode_index: usize,
    pub burst_dps: f64,
    /// Mod names in slot order (exilus-eligible mods may sit in the exilus slot).
    pub mods: Vec<String>,
    pub arcane: Option<String>,
    pub riven: Vec<RivenPick>,
    pub riven_negative: Option<RivenPick>,
    pub marginal: Vec<Marginal>,
    pub evaluations: u64,
    pub objective: Objective,
    /// Value of the objective for this build (burst DPS, sustained DPS, damage per shot or per charge).
    pub score: f64,
    pub fire_rate: f64,
    pub sustained_dps: f64,
    /// Damage per second to the whole group (Conditions::group_size), burst and sustained.
    pub group_dps: f64,
    pub group_sustained_dps: f64,
    pub per_shot: f64,
    pub per_charge: Option<f64>,
    /// Chosen Incarnon evolutions (one per tier that has options).
    pub evolutions: Vec<String>,
    /// Progenitor element (Kuva / Tenet weapons).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progenitor: Option<wf_data::DamageType>,
    /// Modded attack speed (melee) and range of the result.
    pub attack_speed: Option<f64>,
    pub range_m: Option<f64>,
    /// Capacity used in realistic mode.
    pub drain: Option<f64>,
    /// DPS given up for range in comfort mode (fraction).
    pub range_cost: Option<f64>,
    /// True when the attack speed floor couldn't be reached.
    pub below_attack_speed_floor: bool,
}

impl OptimizeResult {
    /// The result as an engine build (riven picks converted to modifiers).
    pub fn to_build(&self, data: &GameData, base: &Build) -> Build {
        Build {
            weapon: self.weapon_id.clone(),
            mods: self.mods.clone(),
            arcane: self.arcane.clone(),
            riven: riven_modifiers(data, &self.riven),
            evolutions: self.evolutions.clone(),
            progenitor: self.progenitor,
            ..base.clone()
        }
    }
}

pub fn riven_modifiers(data: &GameData, picks: &[RivenPick]) -> Vec<Modifier> {
    let Some(table) = &data.riven else { return vec![] };
    picks
        .iter()
        .filter_map(|p| {
            let def = table.stats.iter().find(|s| s.key == p.key)?;
            Some(Modifier {
                source: format!("Riven {}", def.label),
                stat: def.stat?,
                value: p.value,
                max_stacks: 1,
                applies_to: wf_data::ComponentFilter::All,
                condition: wf_data::Condition::Always,
                per: None,
                threshold: None,
                aiming: false,
                only_slots: vec![],
                not_slots: vec![],
                trigger: None,
                mode_contains: None,
                standalone: false,
            })
        })
        .collect()
}

#[derive(Clone)]
struct RivenStat {
    key: String,
    label: String,
    modifier: Modifier,
    spliced: bool,
}

/// At most one spliced stat per riven.
const MAX_SPLICED: usize = 1;

fn riven_ok(riven: &[RivenStat]) -> bool {
    riven.iter().filter(|r| r.spliced).count() <= MAX_SPLICED
}

struct Ctx<'a> {
    weapon: &'a Weapon,
    enemy: Option<EnemyProfile>,
    target: &'a Target,
    build: Build,
    mode: usize,
    candidates: Vec<&'a Mod>,
    evals: u64,
    min_attack_speed: Option<f64>,
    /// Minimum attacks per second (Balanced heavy attacks: +100% over the unmodded heavy).
    min_rate: Option<f64>,
    /// Absolute fire rate cap (shots/s) from `max_fire_rate_bonus`.
    max_rate: Option<f64>,
    min_crit_chance: Option<f64>,
    objective: Objective,
    rate_cap: f64,
    capacity: Option<CapacityOptions>,
    evolutions: Vec<&'a wf_data::Evolution>,
    /// Mods every build must contain (the explosion-radius mod).
    forced: Vec<&'a Mod>,
    /// Builds already calculated (see EvalMemo); `context` identifies the scenario they belong to.
    memo: HashMap<Vec<u64>, Option<Scored>>,
    memo_hits: u64,
    context: u64,
}

/// The Balanced objective stops valuing fire rate past this bonus over the unmodded rate.
pub const BALANCED_FIRE_RATE_BONUS: f64 = 1.5;
/// Melee light attacks: attack speed past this bonus counts for nothing (one Primed Fury's worth),
/// so slots go to damage; Arcane Strike alone fills it.
pub const BALANCED_ATTACK_SPEED_BONUS: f64 = 0.6;
/// Heavy attacks: a comfortable heavy is about +100% faster than unmodded (wind-up speed and attack
/// speed together). The Balanced objective aims for it and values nothing past it.
pub const BALANCED_HEAVY_SPEED_BONUS: f64 = 1.0;

/// Balanced cap for an attack: guns by fire rate, melee light attacks by attack speed, heavies uncapped.
fn balanced_rate_cap(weapon: &Weapon, mode: &wf_data::AttackMode, base_rate: f64) -> f64 {
    match mode.melee_role {
        Some(wf_data::MeleeRole::Heavy) => base_rate * (1.0 + BALANCED_HEAVY_SPEED_BONUS),
        Some(_) => base_rate * (1.0 + BALANCED_ATTACK_SPEED_BONUS),
        None if weapon.slot == wf_data::Slot::Melee => base_rate * (1.0 + BALANCED_ATTACK_SPEED_BONUS),
        None => base_rate * (1.0 + BALANCED_FIRE_RATE_BONUS),
    }
}
/// An attack counts as "explosive" when a radial component reaches this radius and share of base damage.
const EXPLOSIVE_RADIUS_M: f64 = 3.0;
const EXPLOSIVE_SHARE: f64 = 0.25;

fn pool_key(p: wf_data::ModPool) -> &'static str {
    match p {
        wf_data::ModPool::Primary => "primary",
        wf_data::ModPool::Shotgun => "shotgun",
        wf_data::ModPool::Secondary => "secondary",
        wf_data::ModPool::Melee => "melee",
        wf_data::ModPool::ArchGun => "archGun",
        wf_data::ModPool::Companion => "companion",
    }
}

/// Main damage of this attack is a sizeable explosion delivered by a projectile (Torid, Tonkor),
/// not a hitscan rifle with a small pop (Trumna auto, Braton Incarnon).
pub fn is_explosive(mode: &wf_data::AttackMode) -> bool {
    if mode.shot.as_deref() == Some("hitscan") || mode.shot.as_deref() == Some("beam") {
        return false;
    }
    let total: f64 = mode.components.iter().map(|c| c.damage.values().sum::<f64>()).sum();
    let radial: f64 = mode
        .components
        .iter()
        .filter(|c| c.kind == wf_data::HitKind::Radial && c.falloff.as_ref().is_some_and(|f| f.end_m >= EXPLOSIVE_RADIUS_M))
        .map(|c| c.damage.values().sum::<f64>())
        .sum();
    total > 0.0 && radial / total >= EXPLOSIVE_SHARE
}

/// What scoring a build reads from its calculation: the objectives, comfort limits and the crit
/// threshold. Kept instead of the whole result so searches with other objectives can reuse it.
#[derive(Debug, Clone, Copy)]
struct Scored {
    fire_rate: f64,
    attack_speed: Option<f64>,
    magazine_shots: Option<f64>,
    magazine: Option<f64>,
    burst: f64,
    sustained: f64,
    group: f64,
    group_sustained: f64,
    per_shot: f64,
    per_charge: Option<f64>,
    arsenal_crit_chance: f64,
}

impl Scored {
    fn of(m: &wf_calc::ModeResult) -> Self {
        Scored {
            fire_rate: m.fire_rate,
            attack_speed: m.attack_speed,
            magazine_shots: m.magazine_shots,
            magazine: m.magazine.map(|x| x as f64),
            burst: m.burst_dps,
            sustained: m.sustained_dps,
            group: m.group_dps,
            group_sustained: m.group_sustained_dps,
            per_shot: m.per_shot,
            per_charge: m.per_charge,
            arsenal_crit_chance: m.components.iter().map(|c| c.arsenal_crit_chance).fold(0.0, f64::max),
        }
    }
}

/// Builds already calculated, shared by the searches of one weapon against one target (single
/// target and group, with and without riven): they revisit many of the same builds. Entries are
/// keyed by the scenario too, so searches with different conditions never mix.
#[derive(Default)]
pub struct EvalMemo {
    map: HashMap<Vec<u64>, Option<Scored>>,
}

/// Past this many builds the memo starts over (memory stays bounded on long runs).
const MEMO_MAX: usize = 3_000_000;

/// Sustained damage where attacks past `cap` per second count for nothing.
fn balanced(m: &Scored, cap: f64, burst: f64, sustained: f64) -> f64 {
    if m.fire_rate <= cap || m.fire_rate <= 0.0 {
        return sustained;
    }
    // Melee: swings past the cap don't count.
    if m.attack_speed.is_some() {
        return sustained * cap / m.fire_rate;
    }
    // Same shots, but only `cap` of them per second count; reloads still apply.
    let per_shot = burst / m.fire_rate;
    match m.magazine_shots.or(m.magazine) {
        Some(mag) if sustained < burst * (1.0 - 1e-9) => {
            let reload = mag / m.fire_rate * (burst / sustained - 1.0);
            per_shot * mag / (mag / cap + reload)
        }
        _ => per_shot * cap,
    }
}

fn objective_value(objective: Objective, m: &Scored, cap: f64) -> f64 {
    match objective {
        Objective::Balanced => balanced(m, cap, m.burst, m.sustained),
        Objective::Group => balanced(m, cap, m.group, m.group_sustained),
        Objective::Burst => m.burst,
        Objective::Sustained => m.sustained,
        Objective::PerShot => m.per_shot,
        Objective::PerCharge => m.per_charge.unwrap_or_else(|| m.per_shot * m.magazine_shots.unwrap_or(1.0)),
    }
}

impl<'a> Ctx<'a> {
    fn mode_result(&mut self, mods: &[&'a Mod], arcane: Option<&'a Arcane>, riven: &[RivenStat]) -> Option<wf_calc::ModeResult> {
        self.evals += 1;
        self.build.riven = riven.iter().map(|r| r.modifier.clone()).collect();
        let r = Resolved {
            weapon: self.weapon,
            mods: mods.to_vec(),
            arcane,
            evolutions: self.evolutions.clone(),
            enemy: self.enemy.clone(),
            warnings: vec![],
        };
        evaluate(&r, &self.build, self.target, self.mode).ok().filter(|m| m.burst_dps.is_finite())
    }

    fn raw(&mut self, mods: &[&'a Mod], arcane: Option<&'a Arcane>, riven: &[RivenStat]) -> f64 {
        let (objective, cap) = (self.objective, self.rate_cap);
        self.mode_result(mods, arcane, riven).map_or(0.0, |x| objective_value(objective, &Scored::of(&x), cap))
    }

    /// The objective value. Comfort bounds (attack speed floor, fire rate cap) make builds outside
    /// them score negative (closer to the bound is better), so any build within the bounds beats
    /// every build outside them.
    /// Identity of a build within one search: mods in order, arcane, riven stats, evolutions,
    /// progenitor and mode (everything else is fixed while the memo lives).
    fn memo_key(&self, mods: &[&'a Mod], arcane: Option<&'a Arcane>, riven: &[RivenStat]) -> Vec<u64> {
        let mut k = Vec::with_capacity(mods.len() + riven.len() * 2 + self.evolutions.len() + 5);
        k.push(self.context);
        k.push(self.mode as u64);
        k.push(self.build.progenitor.map_or(u64::MAX, |t| t as u64));
        k.push(arcane.map_or(0, |a| a as *const Arcane as u64));
        k.extend(self.evolutions.iter().map(|e| *e as *const wf_data::Evolution as u64));
        k.push(u64::MAX - 1);
        k.extend(mods.iter().map(|m| *m as *const Mod as u64));
        k.push(u64::MAX - 2);
        for r in riven {
            let mut h = std::collections::hash_map::DefaultHasher::new();
            std::hash::Hash::hash(&r.key, &mut h);
            k.push(std::hash::Hasher::finish(&h));
            k.push(r.modifier.value.to_bits());
        }
        k
    }

    /// The scenario fingerprint for memo keys: conditions, buffs, target and weapon.
    fn context_id(&self) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        let text = serde_json::to_string(&(&self.build.conditions, &self.build.buffs, self.target)).unwrap_or_default();
        std::hash::Hash::hash(&text, &mut h);
        std::hash::Hash::hash(&self.weapon.id, &mut h);
        std::hash::Hasher::finish(&h)
    }

    fn eval(&mut self, mods: &[&'a Mod], arcane: Option<&'a Arcane>, riven: &[RivenStat]) -> f64 {
        let key = self.memo_key(mods, arcane, riven);
        let scored = match self.memo.get(&key) {
            Some(s) => {
                self.memo_hits += 1;
                *s
            }
            None => {
                let s = self.mode_result(mods, arcane, riven).map(|m| Scored::of(&m));
                self.memo.insert(key, s);
                s
            }
        };
        self.score(scored)
    }

    /// The search's score for a calculated build: comfort limits and thresholds first (builds outside
    /// them score negative, closer is better), then the objective.
    fn score(&self, scored: Option<Scored>) -> f64 {
        match scored {
            None => f64::NEG_INFINITY,
            Some(m) => {
                let speed = m.attack_speed.unwrap_or(m.fire_rate);
                if let Some(min) = self.min_attack_speed {
                    if speed < min - 1e-9 {
                        return -(min - speed) - 1.0;
                    }
                }
                if let Some(min) = self.min_rate {
                    if m.fire_rate < min - 1e-9 {
                        return -(min - m.fire_rate) / min - 1.0;
                    }
                }
                if let Some(max) = self.max_rate {
                    if m.attack_speed.is_none() && m.fire_rate > max + 1e-9 {
                        return -(m.fire_rate - max) - 1.0;
                    }
                }
                // Tenacious Bond checks the weapon's own (arsenal) crit chance.
                if let Some(min) = self.min_crit_chance {
                    let cc = m.arsenal_crit_chance;
                    if cc < min - 1e-9 {
                        return -(min - cc) - 1.0;
                    }
                }
                objective_value(self.objective, &m, self.rate_cap)
            }
        }
    }

    /// Slots are filled in order; when every normal slot is used, the last mod sits in the
    /// exilus slot, so it must be exilus-eligible. Keeping the exilus last also matches the
    /// element order the build editor sends to the engine.
    fn valid(&self, mods: &[&Mod], normal_slots: usize) -> bool {
        if mods.len() > normal_slots + 1 {
            return false;
        }
        if mods.len() == normal_slots + 1 && !mods[normal_slots].is_exilus {
            return false;
        }
        if !self.forced.iter().all(|f| mods.iter().any(|m| m.id == f.id)) {
            return false;
        }
        if let Some(cap) = &self.capacity {
            if total_drain(mods, normal_slots, cap) > cap.capacity + 1e-9 {
                return false;
            }
        }
        for (i, a) in mods.iter().enumerate() {
            for b in &mods[i + 1..] {
                if a.id == b.id || (a.exclusive_group.is_some() && a.exclusive_group == b.exclusive_group) {
                    return false;
                }
            }
        }
        true
    }

    /// Element plans. Which elements combine depends on the slot order of the element mods, and a plan
    /// like Cold + Toxin into Viral with a separate Heat (on a weapon whose own Cold would otherwise turn
    /// Heat into Blast) needs three mods placed together: no single swap, pair or reorder leads there.
    /// Every order of up to three primary elements starts from the best mod of each, kept mods and a
    /// greedy fill; the full search then runs from the best two.
    fn plan_search(
        &mut self,
        current: Vec<&'a Mod>,
        current_v: f64,
        arcane: Option<&'a Arcane>,
        riven: &[RivenStat],
        normal_slots: usize,
    ) -> (Vec<&'a Mod>, f64) {
        const PRIMARY: [DamageType; 4] = [DamageType::Heat, DamageType::Cold, DamageType::Electricity, DamageType::Toxin];
        let elem_value = |m: &Mod, t: DamageType| m.modifiers.iter().filter(|x| x.stat == Stat::Element(t)).map(|x| x.value).sum::<f64>();
        let has_element = |m: &Mod| m.modifiers.iter().any(|x| matches!(x.stat, Stat::Element(_)));
        let best_of: Vec<Option<&'a Mod>> = PRIMARY
            .iter()
            .map(|&t| {
                self.candidates
                    .iter()
                    .copied()
                    .filter(|m| elem_value(m, t) > 0.0)
                    .max_by(|a, b| elem_value(a, t).total_cmp(&elem_value(b, t)))
            })
            .collect();
        let keep: Vec<&'a Mod> = current.iter().copied().filter(|m| !has_element(m)).collect();
        let mut plans: Vec<Vec<usize>> = Vec::new();
        for a in 0..PRIMARY.len() {
            plans.push(vec![a]);
            for b in (0..PRIMARY.len()).filter(|&b| b != a) {
                plans.push(vec![a, b]);
                for c in (0..PRIMARY.len()).filter(|&c| c != a && c != b) {
                    plans.push(vec![a, b, c]);
                }
            }
        }
        let mut scored: Vec<(Vec<&'a Mod>, f64)> = Vec::new();
        for plan in plans {
            let Some(mut set) = plan.iter().map(|&i| best_of[i]).collect::<Option<Vec<&'a Mod>>>() else { continue };
            set.extend(keep.iter().copied());
            while !self.valid(&set, normal_slots) && set.len() > plan.len() {
                set.pop();
            }
            if !self.valid(&set, normal_slots) {
                continue;
            }
            scored.push(self.search(set, arcane, riven, normal_slots, false));
        }
        scored.sort_by(|a, b| b.1.total_cmp(&a.1));
        let mut best = (current, current_v);
        for (m, _) in scored.into_iter().take(2) {
            let (m, v) = self.search(m, arcane, riven, normal_slots, true);
            if v > best.1 * (1.0 + 1e-9) {
                best = (m, v);
            }
        }
        best
    }

    fn search_mods(
        &mut self,
        start: Vec<&'a Mod>,
        arcane: Option<&'a Arcane>,
        riven: &[RivenStat],
        normal_slots: usize,
    ) -> (Vec<&'a Mod>, f64) {
        self.search(start, arcane, riven, normal_slots, true)
    }

    /// Greedy fill, then (when `local`) best-improvement local search (swap, add, element reorder).
    fn search(
        &mut self,
        start: Vec<&'a Mod>,
        arcane: Option<&'a Arcane>,
        riven: &[RivenStat],
        normal_slots: usize,
        local: bool,
    ) -> (Vec<&'a Mod>, f64) {
        let mut set = start;
        for f in self.forced.clone().into_iter().rev() {
            if !set.iter().any(|m| m.id == f.id) {
                set.insert(0, f);
            }
        }
        let mut best = self.eval(&set, arcane, riven);
        let cands = self.candidates.clone();

        // Greedy fill.
        loop {
            let mut pick: Option<(&Mod, f64)> = None;
            for &c in &cands {
                let mut next = set.clone();
                next.push(c);
                if !self.valid(&next, normal_slots) {
                    continue;
                }
                let v = self.eval(&next, arcane, riven);
                if v > best && pick.is_none_or(|(_, pv)| v > pv) {
                    pick = Some((c, v));
                }
            }
            match pick {
                Some((c, v)) => {
                    set.push(c);
                    best = v;
                }
                None => break,
            }
        }

        // Element pairs: the two strongest mods of each primary element. Element plans (Cold + Toxin into
        // Viral so a Heat source stays pure) need two mods to change together; one at a time never helps.
        let mut elem_cands: Vec<(&'a Mod, DamageType)> = Vec::new();
        for t in [DamageType::Heat, DamageType::Cold, DamageType::Electricity, DamageType::Toxin] {
            let value = |m: &Mod| {
                m.modifiers.iter().filter(|x| x.stat == Stat::Element(t)).map(|x| x.value).sum::<f64>()
            };
            let mut of_t: Vec<&'a Mod> = cands.iter().copied().filter(|m| value(m) > 0.0).collect();
            of_t.sort_by(|a, b| value(b).total_cmp(&value(a)));
            elem_cands.extend(of_t.into_iter().take(2).map(|m| (m, t)));
        }

        // Local search.
        let passes = if local { MAX_PASSES } else { 0 };
        for _ in 0..passes {
            let mut best_move: Option<(Vec<&'a Mod>, f64)> = None;
            let consider = |ctx: &mut Self, next: Vec<&'a Mod>, best_move: &mut Option<(Vec<&'a Mod>, f64)>| {
                if !ctx.valid(&next, normal_slots) {
                    return;
                }
                let v = ctx.eval(&next, arcane, riven);
                if v > best * (1.0 + 1e-9) && best_move.as_ref().is_none_or(|(_, bv)| v > *bv) {
                    *best_move = Some((next, v));
                }
            };
            for i in 0..set.len() {
                for &c in &cands {
                    if set.iter().any(|m| m.id == c.id) {
                        continue;
                    }
                    let mut next = set.clone();
                    next[i] = c;
                    consider(self, next, &mut best_move);
                }
                // Removal can help when a mod hurts (negative stats) and frees an exilus-only spot.
                let mut next = set.clone();
                next.remove(i);
                consider(self, next, &mut best_move);
            }
            for &c in &cands {
                if set.iter().any(|m| m.id == c.id) {
                    continue;
                }
                let mut next = set.clone();
                next.push(c);
                consider(self, next, &mut best_move);
            }
            for order in element_orders(&set) {
                consider(self, order, &mut best_move);
            }
            for (x, (ma, ta)) in elem_cands.iter().enumerate() {
                for (mb, tb) in elem_cands.iter().skip(x + 1) {
                    if ta == tb || set.iter().any(|m| m.id == ma.id || m.id == mb.id) {
                        continue;
                    }
                    for i in 0..set.len() {
                        for j in (i + 1)..set.len() {
                            let mut next = set.clone();
                            next[i] = ma;
                            next[j] = mb;
                            consider(self, next, &mut best_move);
                        }
                    }
                }
            }
            match best_move {
                Some((next, v)) => {
                    set = next;
                    best = v;
                }
                None => break,
            }
        }
        (set, best)
    }

    fn search_riven(
        &mut self,
        mut mods: Vec<&'a Mod>,
        arcane: Option<&'a Arcane>,
        pool: &[RivenStat],
        positives: usize,
    ) -> (Vec<&'a Mod>, Vec<RivenStat>, f64) {
        // The riven takes one normal slot: drop the weakest normal mod if all 8 are used.
        let normal_slots = NORMAL_SLOTS - 1;
        // Forced mods (explosion radius) always stay; stop if nothing else is left to drop.
        let forced = |ctx: &Self, m: &Mod| ctx.forced.iter().any(|f| f.id == m.id);
        while !self.valid(&mods, normal_slots) {
            let full = self.eval(&mods, arcane, &[]);
            let mut weakest: Option<(usize, f64)> = None;
            for i in 0..mods.len() {
                if forced(self, mods[i]) {
                    continue;
                }
                let mut next = mods.clone();
                next.remove(i);
                if !self.valid(&next, normal_slots) && next.len() > normal_slots {
                    continue;
                }
                let loss = full - self.eval(&next, arcane, &[]);
                if weakest.is_none_or(|(_, l)| loss < l) {
                    weakest = Some((i, loss));
                }
            }
            match weakest {
                Some((i, _)) => {
                    mods.remove(i);
                }
                None => match mods.iter().rposition(|m| !forced(self, m)) {
                    Some(i) => {
                        mods.remove(i);
                    }
                    None => break,
                },
            }
        }

        // Riven stats: greedy from several first stats (the best few alone, plus each primary element:
        // element combos like Viral + standalone Heat only pay off once the mods change around them),
        // each followed by alternating mod re-optimization and riven swaps. The best start wins.
        let base_mods = mods.clone();
        let mut firsts: Vec<(usize, f64)> = pool
            .iter()
            .enumerate()
            .filter(|(_, s)| riven_ok(std::slice::from_ref(s)))
            .map(|(i, s)| (i, self.eval(&base_mods, arcane, std::slice::from_ref(s))))
            .collect();
        firsts.sort_by(|a, b| b.1.total_cmp(&a.1));
        let mut seeds: Vec<usize> = firsts.iter().take(RIVEN_SEEDS).map(|f| f.0).collect();
        for (i, s) in pool.iter().enumerate() {
            if matches!(s.modifier.stat, Stat::Element(t) if t.is_primary_element()) && !seeds.contains(&i) {
                seeds.push(i);
            }
        }
        let mut seeds: Vec<Vec<usize>> = seeds.into_iter().map(|i| vec![i]).collect();
        // Stats that only pay off together (crit chance with crit damage, or an element plan that
        // needs the mods to change) can't be reached one stat at a time: every complete riven is
        // scored on the riven-less mods and the best few start a search too.
        if positives >= 2 {
            let mut combos: Vec<(Vec<usize>, f64)> = Vec::new();
            let mut idx: Vec<usize> = (0..positives).collect();
            let n = pool.len();
            if n >= positives {
                loop {
                    let r: Vec<RivenStat> = idx.iter().map(|&i| pool[i].clone()).collect();
                    if riven_ok(&r) {
                        combos.push((idx.clone(), self.eval(&base_mods, arcane, &r)));
                    }
                    // Next combination in lexicographic order.
                    let Some(k) = (0..positives).rev().find(|&k| idx[k] < n - positives + k) else { break };
                    idx[k] += 1;
                    for m in k + 1..positives {
                        idx[m] = idx[m - 1] + 1;
                    }
                }
            }
            combos.sort_by(|a, b| b.1.total_cmp(&a.1));
            seeds.extend(combos.into_iter().take(RIVEN_SEEDS).map(|c| c.0));
        }
        let mut best_overall: Option<(Vec<&'a Mod>, Vec<RivenStat>, f64)> = None;
        for seed in seeds {
            let (m, r, v) = self.riven_from(base_mods.clone(), arcane, pool, positives, normal_slots, &seed, &riven_ok);
            if best_overall.as_ref().is_none_or(|b| v > b.2) {
                best_overall = Some((m, r, v));
            }
        }
        match best_overall {
            Some(b) => b,
            None => {
                let v = self.eval(&base_mods, arcane, &[]);
                (base_mods, vec![], v)
            }
        }
    }

    /// One riven search from given first stats.
    #[allow(clippy::too_many_arguments)]
    fn riven_from(
        &mut self,
        mut mods: Vec<&'a Mod>,
        arcane: Option<&'a Arcane>,
        pool: &[RivenStat],
        positives: usize,
        normal_slots: usize,
        seed: &[usize],
        riven_ok: &dyn Fn(&[RivenStat]) -> bool,
    ) -> (Vec<&'a Mod>, Vec<RivenStat>, f64) {
        let mut riven: Vec<RivenStat> = seed.iter().map(|&i| pool[i].clone()).collect();
        let mut best = self.eval(&mods, arcane, &riven);
        while riven.len() < positives {
            let mut pick: Option<(usize, f64)> = None;
            for (i, s) in pool.iter().enumerate() {
                if riven.iter().any(|r| r.key == s.key) {
                    continue;
                }
                let mut next = riven.clone();
                next.push(s.clone());
                if !riven_ok(&next) {
                    continue;
                }
                let v = self.eval(&mods, arcane, &next);
                if pick.is_none_or(|(_, pv)| v > pv) {
                    pick = Some((i, v));
                }
            }
            let Some((i, v)) = pick else { break };
            riven.push(pool[i].clone());
            best = v;
        }

        // Alternate: re-optimize mods around the riven, then swap riven stats, until stable.
        for _ in 0..10 {
            let (m, v) = self.search_mods(mods.clone(), arcane, &riven, normal_slots);
            let mods_improved = v > best * (1.0 + 1e-9);
            if v >= best {
                mods = m;
                best = v;
            }
            let mut swap: Option<(usize, usize, f64)> = None;
            for i in 0..riven.len() {
                for (j, s) in pool.iter().enumerate() {
                    if riven.iter().any(|r| r.key == s.key) {
                        continue;
                    }
                    let mut next = riven.clone();
                    next[i] = s.clone();
                    if !riven_ok(&next) {
                        continue;
                    }
                    let v = self.eval(&mods, arcane, &next);
                    if v > best * (1.0 + 1e-9) && swap.is_none_or(|(_, _, sv)| v > sv) {
                        swap = Some((i, j, v));
                    }
                }
            }
            // Synergistic stats only pay off together (crit chance with crit damage): when no single
            // swap helps, try replacing two riven stats at once.
            if swap.is_none() && riven.len() >= 2 {
                let mut pair: Option<(usize, usize, usize, usize, f64)> = None;
                for i in 0..riven.len() {
                    for k in i + 1..riven.len() {
                        for (j, s) in pool.iter().enumerate() {
                            for (l, t) in pool.iter().enumerate().skip(j + 1) {
                                if riven.iter().any(|r| r.key == s.key || r.key == t.key) {
                                    continue;
                                }
                                let mut next = riven.clone();
                                next[i] = s.clone();
                                next[k] = t.clone();
                                if !riven_ok(&next) {
                                    continue;
                                }
                                let v = self.eval(&mods, arcane, &next);
                                if v > best * (1.0 + 1e-9) && pair.is_none_or(|p| v > p.4) {
                                    pair = Some((i, k, j, l, v));
                                }
                            }
                        }
                    }
                }
                if let Some((i, k, j, l, v)) = pair {
                    riven[i] = pool[j].clone();
                    riven[k] = pool[l].clone();
                    best = v;
                    continue;
                }
            }
            match swap {
                Some((i, j, v)) => {
                    riven[i] = pool[j].clone();
                    best = v;
                }
                None if !mods_improved => break,
                None => {}
            }
        }
        (mods, riven, best)
    }
}

/// All orderings of the element mods within their current slots (element combination depends on order).
fn element_orders<'a>(set: &[&'a Mod]) -> Vec<Vec<&'a Mod>> {
    let idx: Vec<usize> = set
        .iter()
        .enumerate()
        .filter(|(_, m)| m.modifiers.iter().any(|x| matches!(x.stat, Stat::Element(t) if t.is_primary_element())))
        .map(|(i, _)| i)
        .collect();
    if idx.len() < 2 || idx.len() > 5 {
        return vec![];
    }
    let mut out = Vec::new();
    let mut perm: Vec<usize> = idx.clone();
    permutations(&mut perm, 0, &mut |p| {
        if p != idx.as_slice() {
            let mut next = set.to_vec();
            for (slot, &src) in idx.iter().zip(p.iter()) {
                next[*slot] = set[src];
            }
            out.push(next);
        }
    });
    out
}

fn permutations(v: &mut Vec<usize>, k: usize, f: &mut impl FnMut(&[usize])) {
    if k == v.len() {
        f(v);
        return;
    }
    for i in k..v.len() {
        v.swap(k, i);
        permutations(v, k + 1, f);
        v.swap(k, i);
    }
}

fn stat_matters(stat: Stat, faction: Faction, allow_faction: bool) -> bool {
    match stat {
        Stat::Magazine | Stat::ReloadSpeed => false,
        Stat::FactionDamage(f) => allow_faction && f == faction,
        _ => true,
    }
}

fn arcane_slot(w: &Weapon) -> &'static str {
    match w.slot {
        wf_data::Slot::Primary => "primary",
        wf_data::Slot::Secondary => "secondary",
        wf_data::Slot::Melee => "melee",
        _ => "",
    }
}

/// Riven searches start from this many best single stats (plus every primary element).
const RIVEN_SEEDS: usize = 3;

/// How many of the best unmodded headline modes get a full search when no mode is given.
const MODE_CANDIDATES: usize = 3;

/// Best build for a weapon. Without an explicit mode, the top headline modes (by unmodded DPS)
/// are each optimized and the best result wins, since modding can reorder combos.
pub fn optimize(
    data: &GameData,
    weapon_key: &str,
    base: &Build,
    target: &Target,
    opts: &OptimizeOptions,
) -> Result<OptimizeResult, CalcError> {
    optimize_cached(data, weapon_key, base, target, opts, &mut StructureCache::new(), &mut EvalMemo::default())
}

/// The best build without a riven and the best with one (same options otherwise). The riven search
/// starts from the structures the riven-less search found, so they are searched once: the results
/// are the same as two `optimize` calls.
pub fn optimize_with_riven(
    data: &GameData,
    weapon_key: &str,
    base: &Build,
    target: &Target,
    opts: &OptimizeOptions,
) -> Result<(OptimizeResult, OptimizeResult), CalcError> {
    optimize_with_riven_memo(data, weapon_key, base, target, opts, &mut EvalMemo::default())
}

/// `optimize_with_riven` with a memo the caller keeps across searches of the same weapon and target
/// (other objectives or attacks): builds already calculated aren't calculated again.
pub fn optimize_with_riven_memo(
    data: &GameData,
    weapon_key: &str,
    base: &Build,
    target: &Target,
    opts: &OptimizeOptions,
    memo: &mut EvalMemo,
) -> Result<(OptimizeResult, OptimizeResult), CalcError> {
    let mut cache = StructureCache::new();
    let plain = optimize_cached(data, weapon_key, base, target, &OptimizeOptions { riven: false, ..opts.clone() }, &mut cache, memo)?;
    let riven = optimize_cached(data, weapon_key, base, target, &OptimizeOptions { riven: true, ..opts.clone() }, &mut cache, memo)?;
    Ok((plain, riven))
}

/// Share of an attack's listed damage that is one damage type.
fn damage_share(mode: &wf_data::AttackMode, t: DamageType) -> f64 {
    let total: f64 = mode.components.iter().flat_map(|c| c.damage.values()).sum();
    let of_t: f64 = mode.components.iter().filter_map(|c| c.damage.get(&t)).sum();
    if total > 0.0 { of_t / total } else { 0.0 }
}

/// Whether a riven stat can roll on this weapon, as a positive or as the negative: physical damage
/// types need more than 25% of the attack's damage; elements and Punch Through (and spliced stats) are
/// positive-only; Zoom, Recoil and Ammo Maximum no longer roll on companion weapons.
fn riven_stat_allowed(s: &wf_data::RivenStatDef, weapon: &Weapon, negative: bool) -> bool {
    if let Some(Stat::Physical(t)) = s.stat {
        // The weapon's own stats decide (its main normal attack, not an Incarnon form).
        let main = weapon.modes.iter().find(|m| m.is_headline() && !m.incarnon_form).or(weapon.modes.first());
        if main.is_none_or(|m| damage_share(m, t) <= 0.25) {
            return false;
        }
    }
    if negative && (s.positive_only || s.spliced) {
        return false;
    }
    !(s.vintage_on_companion && weapon.slot == wf_data::Slot::Companion)
}

/// A faction damage negative goes on a faction you rarely fight: Infested (whose content is the
/// easiest), unless the target is Infested, then Grineer or Corpus.
fn faction_negative_ok(s: &wf_data::RivenStatDef, target_faction: Faction) -> bool {
    match s.stat {
        Some(Stat::FactionDamage(f)) => (f == Faction::Infested) != (target_faction == Faction::Infested),
        _ => true,
    }
}

/// The modifier of a riven negative at `roll` (None for stats with no modelled effect).
fn negative_modifier(table: &wf_data::RivenTable, ty: RivenType, layout: &wf_data::RivenLayout, s: &wf_data::RivenStatDef, roll: f64) -> Option<Modifier> {
    let stat = s.stat?;
    Some(Modifier {
        source: format!("Riven {} (negative)", s.label),
        stat,
        value: -s.base.get(&ty)? * table.disposition * layout.negative_mult * roll,
        max_stacks: 1,
        applies_to: s.applies_to.unwrap_or(wf_data::ComponentFilter::All),
        condition: wf_data::Condition::Always,
        per: None,
        threshold: None,
        aiming: false,
        only_slots: vec![],
        not_slots: vec![],
        trigger: None,
        mode_contains: None,
        standalone: false,
    })
}

/// Finalist structures (arcane x evolutions x progenitor with their mods) per attack mode, and whether
/// the element plan search added one in front.
type StructureCache<'a> = BTreeMap<usize, (Vec<Structure<'a>>, bool)>;

fn optimize_cached<'a>(
    data: &'a GameData,
    weapon_key: &str,
    base: &Build,
    target: &'a Target,
    opts: &OptimizeOptions,
    cache: &mut StructureCache<'a>,
    memo: &mut EvalMemo,
) -> Result<OptimizeResult, CalcError> {
    if opts.mode.is_some() {
        return optimize_mode(data, weapon_key, base, target, opts, cache, memo);
    }
    let weapon = data
        .weapon(weapon_key)
        .ok_or_else(|| CalcError::new(ErrorCode::UnknownWeapon, format!("no weapon '{weapon_key}'")))?;
    let unmodded = wf_calc::compute(data, &Build { weapon: weapon.id.clone(), mods: vec![], arcane: None, riven: vec![], ..base.clone() }, target)?;
    let mut ranked: Vec<(bool, f64, usize)> = unmodded
        .modes
        .iter()
        .filter(|m| m.burst_dps.is_finite() && m.burst_dps > 0.0)
        .map(|m| (weapon.modes[m.mode_index].is_headline(), m.burst_dps, m.mode_index))
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.total_cmp(&a.1)));
    let any_headline = ranked.first().is_some_and(|r| r.0);
    let picks: Vec<usize> = ranked
        .iter()
        .filter(|r| r.0 == any_headline)
        .take(if any_headline { MODE_CANDIDATES } else { 1 })
        .map(|r| r.2)
        .collect();
    if picks.is_empty() {
        // Nothing computable: let the single-mode path produce the engine's error.
        return optimize_mode(data, weapon_key, base, target, &OptimizeOptions { mode: Some(0), ..opts.clone() }, cache, memo);
    }
    let mut best: Option<OptimizeResult> = None;
    let mut evals = 0;
    for m in picks {
        let r = optimize_mode(data, weapon_key, base, target, &OptimizeOptions { mode: Some(m), ..opts.clone() }, cache, memo)?;
        evals += r.evaluations;
        let better = best.as_ref().is_none_or(|b| {
            (b.below_attack_speed_floor && !r.below_attack_speed_floor)
                || (b.below_attack_speed_floor == r.below_attack_speed_floor && r.score > b.score)
        });
        if better {
            best = Some(r);
        }
    }
    let mut best = best.expect("at least one mode searched");
    best.evaluations = evals;
    Ok(best)
}

fn optimize_mode<'a>(
    data: &'a GameData,
    weapon_key: &str,
    base: &Build,
    target: &'a Target,
    opts: &OptimizeOptions,
    cache: &mut StructureCache<'a>,
    memo: &mut EvalMemo,
) -> Result<OptimizeResult, CalcError> {
    let weapon = data
        .weapon(weapon_key)
        .ok_or_else(|| CalcError::new(ErrorCode::UnknownWeapon, format!("no weapon '{weapon_key}'")))?;
    let enemy = resolve_enemy(data, target)?;
    let faction = enemy.as_ref().map_or(Faction::None, |e| e.faction);
    let mut build = Build { weapon: weapon.id.clone(), mods: vec![], arcane: None, riven: vec![], ..base.clone() };
    // The search only needs numbers: no explanations or notes.
    build.conditions.calc_only = true;

    let never = |m: &Mod| data.rules.never.iter().any(|n| n.eq_ignore_ascii_case(&m.name));
    let candidates: Vec<&Mod> = data
        .mods
        .iter()
        .filter(|m| {
            m.fits(weapon)
                && !never(m)
                && (m.tennokai_every.is_some() || m.modifiers.iter().any(|x| stat_matters(x.stat, faction, opts.allow_faction)))
        })
        .collect();

    let mut ctx = Ctx {
        weapon,
        enemy,
        target,
        build,
        mode: 0,
        candidates,
        evals: 0,
        memo: HashMap::new(),
        memo_hits: 0,
        context: 0,
        min_attack_speed: opts.min_attack_speed,
        min_rate: None,
        max_rate: None,
        min_crit_chance: opts.min_crit_chance,
        objective: opts.objective,
        rate_cap: f64::INFINITY,
        capacity: opts.capacity.clone(),
        evolutions: vec![],
        forced: vec![],
    };
    // Builds already calculated by earlier searches of this weapon and target.
    ctx.memo = std::mem::take(&mut memo.map);
    ctx.context = ctx.context_id();

    let mode = match opts.mode {
        Some(m) => m,
        None => {
            let mut scored: Vec<(usize, bool, f64)> = (0..weapon.modes.len())
                .map(|i| {
                    ctx.mode = i;
                    (i, weapon.modes[i].is_headline(), ctx.eval(&[], None, &[]))
                })
                .collect();
            // Headline modes first, then by unmodded DPS.
            scored.sort_by(|a, b| b.1.cmp(&a.1).then(b.2.total_cmp(&a.2)));
            scored.iter().find(|s| s.2.is_finite()).or(scored.first()).map_or(0, |s| s.0)
        }
    };
    ctx.mode = mode;
    // Fire rate caps are relative to the unmodded rate of this attack (charge timing included).
    let base_rate = ctx.mode_result(&[], None, &[]).map_or(0.0, |m| m.fire_rate);
    if base_rate > 0.0 {
        ctx.rate_cap = balanced_rate_cap(weapon, &weapon.modes[mode], base_rate);
        if matches!(opts.objective, Objective::Balanced | Objective::Group) && weapon.modes[mode].melee_role == Some(wf_data::MeleeRole::Heavy) {
            ctx.min_rate = Some(base_rate * (1.0 + BALANCED_HEAVY_SPEED_BONUS));
        }
        ctx.max_rate = opts.max_fire_rate_bonus.map(|b| base_rate * (1.0 + b));
    }
    // Judged on the weapon's main fire mode (Torid: grenades yes; Trumna: the auto rifle, no).
    let main_mode = weapon.modes.iter().find(|m| m.is_headline() && !m.incarnon_form).or(weapon.modes.first());
    if main_mode.is_some_and(is_explosive) {
        // Explosions can't headshot: headshot-triggered mods (Galvanized Scope, Deadhead) are dead weight.
        ctx.build.conditions.headshot_effects = false;
        ctx.build.conditions.headshot_share = 0.0;
    }
    if opts.explosion_mod && main_mode.is_some_and(is_explosive) {
        let names = data.rules.explosion_radius.get(pool_key(weapon.mod_pool)).cloned().unwrap_or_default();
        if let Some(m) = names.iter().filter_map(|n| data.find_mod(n)).find(|m| m.fits(weapon)) {
            ctx.forced = vec![m];
        }
    }
    let mode_def = weapon
        .modes
        .get(mode)
        .ok_or_else(|| CalcError::new(ErrorCode::MissingField, format!("{} has no mode {mode}", weapon.name)))?;
    // Conditions are final from here on (explosives can't headshot).
    ctx.context = ctx.context_id();
    if !ctx.eval(&[], None, &[]).is_finite() {
        let r = Resolved { weapon, mods: vec![], arcane: None, evolutions: vec![], enemy: ctx.enemy.clone(), warnings: vec![] };
        return Err(match evaluate(&r, &ctx.build, target, mode) {
            Err(e) => e,
            Ok(v) => CalcError::new(ErrorCode::NonFinite, format!("{} / {} gives {}", weapon.name, mode_def.name, v.burst_dps)),
        });
    }

    // Structural choices (arcane x Incarnon evolutions) interact strongly with the mods: Devouring
    // Attrition wants a low-crit build, Enervate feeds Overwhelming Attrition, etc. Every
    // combination gets its own mod search: a greedy pass for all, full local search for the best few.
    let arcanes: Vec<Option<&Arcane>> = {
        let slot = arcane_slot(weapon);
        let list: Vec<Option<&Arcane>> = if let Some(a) = opts.fixed_arcane.as_deref().and_then(|n| data.find_arcane(n)) {
            vec![Some(a)]
        } else if opts.arcane {
            data.arcanes
                .iter()
                .filter(|a| a.slot == slot && (a.classes.is_empty() || a.classes.contains(&weapon.class)))
                .filter(|a| {
                    a.behaviour.is_some()
                        || a.combo_floor.is_some()
                        || a.modifiers.iter().any(|m| stat_matters(m.stat, faction, opts.allow_faction))
                })
                .map(Some)
                .collect()
        } else {
            vec![]
        };
        if list.is_empty() { vec![None] } else { list }
    };
    let evo_combos = evolution_combos(weapon, opts.evolutions, faction, opts.allow_faction, &opts.fixed_evolutions);

    let fixed: Vec<RivenStat> = opts
        .fixed_riven
        .iter()
        .map(|m| RivenStat { key: m.source.clone(), label: m.source.trim_start_matches("Riven ").to_string(), modifier: m.clone(), spliced: false })
        .collect();
    let structure_slots = if fixed.is_empty() { NORMAL_SLOTS } else { NORMAL_SLOTS - 1 };

    // Kuva / Tenet: the progenitor element is part of the structure (it changes which elements to mod).
    let progenitors: Vec<Option<wf_data::DamageType>> = match (weapon.progenitor, opts.progenitor) {
        (false, _) => vec![None],
        (true, Some(t)) => vec![Some(t)],
        (true, None) => wf_calc::PROGENITOR_ELEMENTS.iter().map(|t| Some(*t)).collect(),
    };
    let (finals, plan_added): (Vec<Structure<'a>>, bool) = if let Some(f) = cache.get(&mode) {
        f.clone()
    } else {
    let mut candidates_found: Vec<Structure<'_>> = Vec::new();
    for &pg in &progenitors {
        ctx.build.progenitor = pg;
        for &a in &arcanes {
            for evos in &evo_combos {
                ctx.evolutions = evos.clone();
                let (m, v) = ctx.search(vec![], a, &fixed, structure_slots, false);
                candidates_found.push(Structure { score: v, progenitor: pg, arcane: a, evolutions: evos.clone(), mods: m });
            }
        }
    }
    candidates_found.sort_by(|x, y| y.score.total_cmp(&x.score));
    let mut finals: Vec<Structure<'_>> = Vec::new();
    for c in candidates_found.into_iter().take(STRUCTURE_FINALISTS) {
        ctx.evolutions = c.evolutions.clone();
        ctx.build.progenitor = c.progenitor;
        let (m, v) = ctx.search(c.mods.clone(), c.arcane, &fixed, structure_slots, true);
        finals.push(Structure { score: v, mods: m, ..c });
    }
    finals.sort_by(|x, y| y.score.total_cmp(&x.score));
    // The best structure also tries every element plan (see plan_search). A better plan goes first,
    // and the original stays a finalist: the riven may suit either.
    let mut plan_added = false;
    if let Some(top) = finals.first().cloned() {
        ctx.evolutions = top.evolutions.clone();
        ctx.build.progenitor = top.progenitor;
        let (m, v) = ctx.plan_search(top.mods.clone(), top.score, top.arcane, &fixed, structure_slots);
        if v > top.score * (1.0 + 1e-9) {
            finals.insert(0, Structure { score: v, mods: m, ..top });
            plan_added = true;
        }
    }
    cache.insert(mode, (finals.clone(), plan_added));
    (finals, plan_added)
    };

    let top = finals[0].clone();
    let mut mods = top.mods.clone();
    let mut best = top.score;
    let mut arcane = top.arcane;
    ctx.evolutions = top.evolutions.clone();
    ctx.build.progenitor = top.progenitor;
    let mut riven: Vec<RivenStat> = fixed.clone();
    let mut negative: Option<RivenPick> = None;

    if fixed.is_empty() && opts.riven {
        let table = data
            .riven
            .as_ref()
            .ok_or_else(|| CalcError::new(ErrorCode::MissingField, "game data has no riven table"))?;
        let ty = RivenType::for_pool(weapon.mod_pool);
        let roll = table.roll_min + (table.roll_max - table.roll_min) * opts.riven_roll.clamp(0.0, 1.0);
        let mut best_riven: Option<(Structure<'_>, Vec<RivenStat>, RivenPick, Option<Modifier>)> = None;
        // The riven can change which structure wins, so try it on the best two.
        // One more when the element plan search added a structure, so the original runner-up still gets one.
        for st in finals.iter().take(RIVEN_STRUCTURES + usize::from(plan_added)) {
            ctx.evolutions = st.evolutions.clone();
            ctx.build.progenitor = st.progenitor;
            for positives in [3usize, 2] {
                let Some(layout) = table.layout(positives, true) else { continue };
                // The negative at its smallest penalty (the best riven): a harmless stat when one can roll,
                // otherwise (companion weapons) the one that costs this build least.
                let neg_roll = table.roll_min + table.roll_max - roll;
                let neg_value = |s: &wf_data::RivenStatDef| -s.base[&ty] * table.disposition * layout.negative_mult * neg_roll;
                let neg_modifier = |s: &wf_data::RivenStatDef| negative_modifier(table, ty, layout, s, neg_roll);
                // -Projectile Speed is only free on hitscan and beam attacks (it isn't modelled).
                let hitscan = matches!(weapon.modes[mode].shot.as_deref(), Some("hitscan") | Some("beam"));
                let harmless = |s: &wf_data::RivenStatDef| s.stat.is_none() && (s.key != "PFS" || hitscan);
                let negatives: Vec<&wf_data::RivenStatDef> = table
                    .stats
                    .iter()
                    .filter(|s| s.base.contains_key(&ty) && riven_stat_allowed(s, weapon, true))
                    .filter(|s| faction_negative_ok(s, faction))
                    .collect();
                let neg_def = match negatives.iter().find(|s| harmless(s)) {
                    Some(s) => *s,
                    None => {
                        let mut best_neg: Option<(&wf_data::RivenStatDef, f64)> = None;
                        for s in negatives.iter().filter(|s| s.stat.is_some()) {
                            let saved = std::mem::take(&mut ctx.build.buffs);
                            ctx.build.buffs = saved.iter().cloned().chain(neg_modifier(s)).collect();
                            ctx.context = ctx.context_id();
                            let v = ctx.eval(&st.mods, st.arcane, &[]);
                            ctx.build.buffs = saved;
                            ctx.context = ctx.context_id();
                            if best_neg.is_none_or(|(_, bv)| v > bv) {
                                best_neg = Some((s, v));
                            }
                        }
                        let Some((s, _)) = best_neg else { continue };
                        s
                    }
                };
                // A real negative counts in every evaluation of this riven's search.
                let neg_mod = neg_modifier(neg_def);
                let base_buffs = ctx.build.buffs.clone();
                if let Some(m) = &neg_mod {
                    ctx.build.buffs.push(m.clone());
                    ctx.context = ctx.context_id();
                }
                let pool: Vec<RivenStat> = table
                    .stats
                    .iter()
                    .filter(|s| opts.spliced_riven || !s.spliced)
                    .filter(|s| riven_stat_allowed(s, weapon, false))
                    .filter_map(|s| {
                        let stat = s.stat?;
                        let base = *s.base.get(&ty)?;
                        stat_matters(stat, faction, opts.allow_faction).then(|| RivenStat {
                            spliced: s.spliced,
                            key: s.key.clone(),
                            label: s.label.clone(),
                            modifier: Modifier {
                                source: format!("Riven {}", s.label),
                                stat,
                                value: base * table.disposition * layout.positive_mult * roll,
                                max_stacks: 1,
                                applies_to: s.applies_to.unwrap_or(wf_data::ComponentFilter::All),
                                condition: wf_data::Condition::Always,
                                per: None,
                                threshold: None,
                                aiming: false,
                                only_slots: vec![],
                                not_slots: vec![],
                                trigger: None,
                                mode_contains: None,
                                standalone: false,
                            },
                        })
                    })
                    .collect();
                let (m, r, v) = ctx.search_riven(st.mods.clone(), st.arcane, &pool, positives);
                let neg = RivenPick { key: neg_def.key.clone(), label: neg_def.label.clone(), value: neg_value(neg_def) };
                if best_riven.as_ref().is_none_or(|(b, _, _, _)| v > b.score) {
                    best_riven = Some((Structure { score: v, mods: m, ..st.clone() }, r, neg, neg_mod.clone()));
                }
                if neg_mod.is_some() {
                    ctx.build.buffs = base_buffs;
                    ctx.context = ctx.context_id();
                }
            }
        }
        if let Some((st, r, neg, neg_mod)) = best_riven {
            // The chosen negative stays in effect for the rest of the search (exilus, final numbers).
            if let Some(m) = neg_mod {
                ctx.build.buffs.push(m);
                ctx.context = ctx.context_id();
            }
            mods = st.mods;
            best = st.score;
            arcane = st.arcane;
            ctx.evolutions = st.evolutions;
            riven = r;
            negative = Some(neg);
        }
    }

    // Discouraged mods (Heavy Caliber) stay only if every alternative is clearly worse.
    {
        let normal_slots = if riven.is_empty() { NORMAL_SLOTS } else { NORMAL_SLOTS - 1 };
        for (name, tol) in data.rules.discouraged.clone() {
            let Some(i) = mods.iter().position(|m| m.name.eq_ignore_ascii_case(&name)) else { continue };
            let mut alt: Option<(Vec<&Mod>, f64)> = None;
            for &c in ctx.candidates.clone().iter() {
                if mods.iter().any(|m| m.id == c.id) || c.name.eq_ignore_ascii_case(&name) {
                    continue;
                }
                let mut next = mods.clone();
                next[i] = c;
                if !ctx.valid(&next, normal_slots) {
                    continue;
                }
                let v = ctx.eval(&next, arcane, &riven);
                if alt.as_ref().is_none_or(|(_, av)| v > *av) {
                    alt = Some((next, v));
                }
            }
            if let Some((next, v)) = alt {
                if v >= best * (1.0 - tol) {
                    mods = next;
                    best = v;
                }
            }
        }
    }

    // Exilus: a damage mod gets there through the search when it helps. Otherwise a utility mod
    // that suits the attack (beam range, projectile speed, recoil/ammo), never junk.
    {
        let normal_slots = if riven.is_empty() { NORMAL_SLOTS } else { NORMAL_SLOTS - 1 };
        if mods.len() == normal_slots {
            let shot = weapon.modes.get(mode).and_then(|m| m.shot.clone()).unwrap_or_default();
            let kind = match shot.as_str() {
                "beam" => "beam",
                "hitscan" => "hitscan",
                _ => "projectile",
            };
            let names = data
                .rules
                .utility_exilus
                .get(pool_key(weapon.mod_pool))
                .and_then(|m| m.get(kind))
                .cloned()
                .unwrap_or_default();
            for n in names {
                let Some(m) = data.find_mod(&n) else { continue };
                if !m.is_exilus || !m.fits(weapon) || mods.iter().any(|x| x.id == m.id) {
                    continue;
                }
                let mut next = mods.clone();
                next.push(m);
                if ctx.valid(&next, normal_slots) {
                    let v = ctx.eval(&next, arcane, &riven);
                    if v >= best * (1.0 - 1e-9) {
                        mods = next;
                        best = v;
                        break;
                    }
                }
            }
        }
        // Melee: a matching max-rank stance adds capacity on top of the 60.
        let max_capacity = 60.0 + weapon.stance_capacity.unwrap_or(0.0);
        // If even a fully forma'd build can't fit 60 capacity, the exilus goes first.
        let full_forma = |ms: &[&Mod]| -> f64 {
            ms.iter().map(|m| ((m.base_drain + m.max_rank as i32).max(0) as f64 / 2.0).ceil()).sum::<f64>()
                + if riven.is_empty() { 0.0 } else { 9.0 }
        };
        if mods.len() == normal_slots + 1 && full_forma(&mods) > max_capacity {
            let exilus = mods.pop().unwrap();
            // A cheaper exilus that still fits, if one is as good.
            let mut swap: Option<(&Mod, f64)> = None;
            for m in data.mods.iter().filter(|m| m.is_exilus && m.fits(weapon) && !never(m) && m.id != exilus.id) {
                let mut next = mods.clone();
                next.push(m);
                if full_forma(&next) > max_capacity || !ctx.valid(&next, normal_slots) {
                    continue;
                }
                let v = ctx.eval(&next, arcane, &riven);
                if v >= best * (1.0 - 1e-9) && swap.is_none_or(|(_, sv)| v > sv) {
                    swap = Some((m, v));
                }
            }
            if let Some((m, v)) = swap {
                mods.push(m);
                best = v;
            } else {
                best = ctx.eval(&mods, arcane, &riven);
            }
        }
    }

    // Comfort: trade a little DPS for range on melee weapons.
    let normal_slots = if riven.is_empty() { NORMAL_SLOTS } else { NORMAL_SLOTS - 1 };
    let mut range_cost = None;
    if let (Some(tol), Some(_)) = (opts.range_tolerance, &weapon.melee) {
        let range_mods: Vec<&Mod> = data
            .mods
            .iter()
            .filter(|m| m.fits(weapon) && m.modifiers.iter().any(|x| x.stat == Stat::Range && x.value > 0.0))
            .collect();
        let mut best_swap: Option<(Vec<&Mod>, f64)> = None;
        for &rm in &range_mods {
            if mods.iter().any(|m| m.id == rm.id) {
                continue;
            }
            let mut options: Vec<Vec<&Mod>> = (0..mods.len())
                .map(|i| {
                    let mut n = mods.clone();
                    n[i] = rm;
                    n
                })
                .collect();
            let mut added = mods.clone();
            added.insert(added.len().min(normal_slots), rm);
            options.push(added);
            for n in options {
                if !ctx.valid(&n, normal_slots) {
                    continue;
                }
                let v = ctx.eval(&n, arcane, &riven);
                if v >= best * (1.0 - tol) && best_swap.as_ref().is_none_or(|(_, bv)| v > *bv) {
                    best_swap = Some((n, v));
                }
            }
        }
        if let Some((n, v)) = best_swap {
            range_cost = Some(1.0 - v / best);
            mods = n;
            best = v;
        }
    }

    let final_mode = ctx.mode_result(&mods, arcane, &riven);
    if let Some(m) = &final_mode {
        best = objective_value(opts.objective, &Scored::of(m), ctx.rate_cap);
    }

    // Marginal value of each piece, on raw DPS (not the attack-speed-floor score).
    let mut marginal = Vec::new();
    for i in 0..mods.len() {
        let mut next = mods.clone();
        next.remove(i);
        let v = ctx.raw(&next, arcane, &riven);
        marginal.push(Marginal { label: mods[i].name.clone(), kind: "mod".into(), loss: 1.0 - v / best });
    }
    for i in 0..riven.len() {
        let mut next = riven.clone();
        next.remove(i);
        let v = ctx.raw(&mods, arcane, &next);
        marginal.push(Marginal { label: format!("Riven {}", riven[i].label), kind: "riven".into(), loss: 1.0 - v / best });
    }
    if let Some(a) = arcane {
        let v = ctx.raw(&mods, None, &riven);
        marginal.push(Marginal { label: a.name.clone(), kind: "arcane".into(), loss: 1.0 - v / best });
    }
    for i in 0..ctx.evolutions.len() {
        let kept = ctx.evolutions.clone();
        ctx.evolutions.remove(i);
        let v = ctx.raw(&mods, arcane, &riven);
        ctx.evolutions = kept;
        let loss = 1.0 - v / best;
        if loss.abs() > 1e-9 {
            marginal.push(Marginal { label: ctx.evolutions[i].name.clone(), kind: "evolution".into(), loss });
        }
    }
    marginal.sort_by(|a, b| b.loss.total_cmp(&a.loss));

    let attack_speed = final_mode.as_ref().and_then(|m| m.attack_speed);
    let range_m = final_mode.as_ref().and_then(|m| m.range_m);
    let below_floor = match (opts.min_attack_speed, &final_mode) {
        (Some(min), Some(m)) => m.attack_speed.unwrap_or(m.fire_rate) < min - 1e-9,
        _ => false,
    } || matches!((ctx.max_rate, &final_mode), (Some(max), Some(m)) if m.attack_speed.is_none() && m.fire_rate > max + 1e-9)
        || matches!((ctx.min_rate, &final_mode), (Some(min), Some(m)) if m.fire_rate < min - 1e-9)
        || matches!((opts.min_crit_chance, &final_mode), (Some(min), Some(m)) if m.components.iter().map(|c| c.arsenal_crit_chance).fold(0.0, f64::max) < min - 1e-9);
    let drain = opts.capacity.as_ref().map(|c| total_drain(&mods, normal_slots, c));

    let fm = final_mode.as_ref();
    memo.map = std::mem::take(&mut ctx.memo);
    if memo.map.len() > MEMO_MAX {
        memo.map.clear();
    }
    Ok(OptimizeResult {
        objective: opts.objective,
        score: best,
        fire_rate: fm.map_or(0.0, |m| m.fire_rate),
        sustained_dps: fm.map_or(0.0, |m| m.sustained_dps),
        group_dps: fm.map_or(0.0, |m| m.group_dps),
        group_sustained_dps: fm.map_or(0.0, |m| m.group_sustained_dps),
        per_shot: fm.map_or(0.0, |m| m.per_shot),
        per_charge: fm.and_then(|m| m.per_charge),
        attack_speed,
        range_m,
        drain,
        range_cost,
        below_attack_speed_floor: below_floor,
        weapon_id: weapon.id.clone(),
        weapon: weapon.name.clone(),
        mode: mode_def.name.clone(),
        mode_index: mode,
        burst_dps: fm.map_or(best, |m| m.burst_dps),
        mods: mods.iter().map(|m| m.name.clone()).collect(),
        arcane: arcane.map(|a| a.name.clone()),
        riven: riven
            .iter()
            .map(|r| RivenPick { key: r.key.clone(), label: r.label.clone(), value: r.modifier.value })
            .collect(),
        riven_negative: negative,
        marginal,
        evaluations: ctx.evals,
        evolutions: ctx.evolutions.iter().map(|e| e.name.clone()).collect(),
        progenitor: ctx.build.progenitor,
    })
}

/// One riven roll (its positive stats) and how good it is for a weapon.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RivenRoll {
    pub stats: Vec<RivenPick>,
    /// Objective value of the weapon's build with this riven (max rolls, harmless negative).
    pub score: f64,
    /// `score` as a fraction of the best roll's.
    pub ratio: f64,
    pub spliced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RivenRanking {
    pub weapon: String,
    pub mode: String,
    /// The build the rolls were scored with (the riven takes one normal slot).
    pub mods: Vec<String>,
    pub arcane: Option<String>,
    pub rolls: Vec<RivenRoll>,
    pub evaluations: u64,
}

/// Rank every riven roll (2 or 3 positive stats, harmless negative, max rolls) for a weapon.
/// Rolls are scored against the weapon's best riven build with its riven removed, so ranking
/// hundreds of rolls stays fast; the mods aren't re-optimized per roll.
pub fn rank_rivens(data: &GameData, weapon_key: &str, base: &Build, target: &Target, opts: &OptimizeOptions) -> Result<RivenRanking, CalcError> {
    let best = optimize(data, weapon_key, base, target, &OptimizeOptions { riven: true, ..opts.clone() })?;
    let weapon = data.weapon(weapon_key).ok_or_else(|| CalcError::new(ErrorCode::UnknownWeapon, weapon_key.to_string()))?;
    let table = data.riven.as_ref().ok_or_else(|| CalcError::new(ErrorCode::MissingField, "game data has no riven table"))?;
    let enemy = resolve_enemy(data, target)?;
    let faction = enemy.as_ref().map_or(Faction::None, |e| e.faction);
    let ty = RivenType::for_pool(weapon.mod_pool);
    let mods: Vec<&Mod> = best.mods.iter().filter_map(|n| data.find_mod(n)).collect();
    let arcane = best.arcane.as_deref().and_then(|a| data.find_arcane(a));
    let evolutions: Vec<&wf_data::Evolution> = best.evolutions.iter().filter_map(|e| weapon.evolution(e)).collect();
    let mut ctx = Ctx {
        weapon,
        enemy,
        target,
        build: Build { weapon: weapon.id.clone(), mods: vec![], arcane: None, riven: vec![], progenitor: best.progenitor, ..base.clone() },
        mode: best.mode_index,
        candidates: vec![],
        evals: 0,
        memo: HashMap::new(),
        memo_hits: 0,
        context: 0,
        min_attack_speed: opts.min_attack_speed,
        min_rate: None,
        max_rate: None,
        min_crit_chance: opts.min_crit_chance,
        objective: opts.objective,
        rate_cap: f64::INFINITY,
        capacity: None,
        evolutions,
        forced: vec![],
    };
    ctx.context = ctx.context_id();
    if let Some(base) = ctx.mode_result(&[], None, &[]).map(|m| m.fire_rate).filter(|r| *r > 0.0) {
        ctx.rate_cap = balanced_rate_cap(weapon, &weapon.modes[best.mode_index], base);
        ctx.max_rate = opts.max_fire_rate_bonus.map(|b| base * (1.0 + b));
    }
    let roll = table.roll_max;
    // The negative the best riven got (a real one on companion weapons) counts in every roll's score.
    let negative_def = best.riven_negative.as_ref().and_then(|n| table.stats.iter().find(|s| s.key == n.key));
    let base_buffs = ctx.build.buffs.clone();
    let pool: Vec<&wf_data::RivenStatDef> = table
        .stats
        .iter()
        .filter(|s| (opts.spliced_riven || !s.spliced) && s.base.contains_key(&ty))
        .filter(|s| riven_stat_allowed(s, weapon, false))
        .filter(|s| s.stat.is_some_and(|st| stat_matters(st, faction, opts.allow_faction)))
        .collect();
    let mut rolls = Vec::new();
    for positives in [3usize, 2] {
        let Some(layout) = table.layout(positives, true) else { continue };
        ctx.build.buffs = base_buffs.iter().cloned().chain(negative_def.and_then(|s| negative_modifier(table, ty, layout, s, table.roll_min))).collect();
        ctx.context = ctx.context_id();
        let mut idx: Vec<usize> = (0..positives).collect();
        loop {
            let defs: Vec<&wf_data::RivenStatDef> = idx.iter().map(|&i| pool[i]).collect();
            let spliced = defs.iter().filter(|d| d.spliced).count();
            if spliced <= MAX_SPLICED {
                let stats: Vec<RivenStat> = defs
                    .iter()
                    .map(|d| RivenStat {
                        key: d.key.clone(),
                        label: d.label.clone(),
                        spliced: d.spliced,
                        modifier: Modifier {
                            source: format!("Riven {}", d.label),
                            stat: d.stat.unwrap(),
                            value: d.base[&ty] * table.disposition * layout.positive_mult * roll,
                            max_stacks: 1,
                            applies_to: d.applies_to.unwrap_or(wf_data::ComponentFilter::All),
                            condition: wf_data::Condition::Always,
                            per: None,
                            threshold: None,
                            aiming: false,
                            only_slots: vec![],
                            not_slots: vec![],
                            trigger: None,
                            mode_contains: None,
                            standalone: false,
                        },
                    })
                    .collect();
                let score = ctx.raw(&mods, arcane, &stats);
                rolls.push(RivenRoll {
                    stats: stats.iter().map(|r| RivenPick { key: r.key.clone(), label: r.label.clone(), value: r.modifier.value }).collect(),
                    score,
                    ratio: 0.0,
                    spliced: spliced > 0,
                });
            }
            // Next combination of `positives` indices out of pool.len().
            let n = pool.len();
            let mut i = positives;
            while i > 0 && idx[i - 1] == n - positives + i - 1 {
                i -= 1;
            }
            if i == 0 {
                break;
            }
            idx[i - 1] += 1;
            for j in i..positives {
                idx[j] = idx[j - 1] + 1;
            }
        }
    }
    rolls.sort_by(|a, b| b.score.total_cmp(&a.score));
    let top = rolls.first().map_or(1.0, |r| r.score.max(f64::MIN_POSITIVE));
    for r in &mut rolls {
        r.ratio = r.score / top;
    }
    Ok(RivenRanking {
        weapon: weapon.name.clone(),
        mode: best.mode,
        mods: best.mods,
        arcane: best.arcane,
        rolls,
        evaluations: ctx.evals + best.evaluations,
    })
}

#[cfg(test)]
mod tests;
