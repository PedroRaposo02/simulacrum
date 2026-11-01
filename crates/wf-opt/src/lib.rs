//! Build optimizer: greedy fill, then best-improvement local search over mod swaps and element
//! order, then arcane choice, then an optional theoretical riven searched jointly with the mods.

use serde::{Deserialize, Serialize};
use wf_calc::{evaluate, resolve_enemy, Build, CalcError, ErrorCode, Resolved, Target};
use wf_data::{Arcane, EnemyProfile, Faction, GameData, Mod, Modifier, RivenType, Stat, Weapon};

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
    arcane: Option<&'a Arcane>,
    evolutions: Vec<&'a wf_data::Evolution>,
    mods: Vec<&'a Mod>,
}

/// One option per tier. Options with no damage effect are interchangeable, so each tier keeps
/// one of them plus every option that does something; the product is capped.
fn evolution_combos(weapon: &Weapon, enabled: bool, faction: Faction, allow_faction: bool) -> Vec<Vec<&wf_data::Evolution>> {
    if !enabled || weapon.evolutions.is_empty() {
        return vec![vec![]];
    }
    let effective = |e: &wf_data::Evolution| e.behaviour.is_some() || e.modifiers.iter().any(|m| stat_matters(m.stat, faction, allow_faction));
    let mut combos: Vec<Vec<&wf_data::Evolution>> = vec![vec![]];
    for tier in weapon.evolutions.iter().filter(|t| !t.options.is_empty()) {
        let mut opts: Vec<&wf_data::Evolution> = tier.options.iter().filter(|e| effective(e)).collect();
        if let Some(inert) = tier.options.iter().find(|e| !effective(e)) {
            opts.push(inert);
        }
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
    /// Damage per second while firing.
    #[default]
    Burst,
    /// Damage per second including reloads.
    Sustained,
    /// Damage of one shot (one combo for melee).
    PerShot,
    /// Damage of a full Incarnon charge, or of one magazine for normal weapons. Fire rate adds
    /// nothing here, so it favours damage stats.
    PerCharge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OptimizeOptions {
    pub objective: Objective,
    /// Comfort for guns: builds above this fire rate (shots/s) rank below builds within it.
    pub max_fire_rate: Option<f64>,
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
            spliced_riven: true,
            objective: Objective::Burst,
            max_fire_rate: None,
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
    pub per_shot: f64,
    pub per_charge: Option<f64>,
    /// Chosen Incarnon evolutions (one per tier that has options).
    pub evolutions: Vec<String>,
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
    max_fire_rate: Option<f64>,
    objective: Objective,
    capacity: Option<CapacityOptions>,
    evolutions: Vec<&'a wf_data::Evolution>,
}

fn objective_value(objective: Objective, m: &wf_calc::ModeResult) -> f64 {
    match objective {
        Objective::Burst => m.burst_dps,
        Objective::Sustained => m.sustained_dps,
        Objective::PerShot => m.per_shot,
        Objective::PerCharge => m.per_charge.unwrap_or_else(|| m.per_shot * m.magazine.unwrap_or(1) as f64),
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
        let objective = self.objective;
        self.mode_result(mods, arcane, riven).map_or(0.0, |x| objective_value(objective, &x))
    }

    /// The objective value. Comfort bounds (attack speed floor, fire rate cap) make builds outside
    /// them score negative (closer to the bound is better), so any build within the bounds beats
    /// every build outside them.
    fn eval(&mut self, mods: &[&'a Mod], arcane: Option<&'a Arcane>, riven: &[RivenStat]) -> f64 {
        match self.mode_result(mods, arcane, riven) {
            None => f64::NEG_INFINITY,
            Some(m) => {
                let speed = m.attack_speed.unwrap_or(m.fire_rate);
                if let Some(min) = self.min_attack_speed {
                    if speed < min - 1e-9 {
                        return -(min - speed) - 1.0;
                    }
                }
                if let Some(max) = self.max_fire_rate {
                    if m.attack_speed.is_none() && m.fire_rate > max + 1e-9 {
                        return -(m.fire_rate - max) - 1.0;
                    }
                }
                objective_value(self.objective, &m)
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
        while !self.valid(&mods, normal_slots) {
            let full = self.eval(&mods, arcane, &[]);
            let mut weakest: Option<(usize, f64)> = None;
            for i in 0..mods.len() {
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
                None => {
                    mods.pop();
                }
            }
        }

        // Greedy riven stats.
        let mut riven: Vec<RivenStat> = Vec::new();
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
        _ => "",
    }
}

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
    if opts.mode.is_some() {
        return optimize_mode(data, weapon_key, base, target, opts);
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
        return optimize_mode(data, weapon_key, base, target, &OptimizeOptions { mode: Some(0), ..opts.clone() });
    }
    let mut best: Option<OptimizeResult> = None;
    let mut evals = 0;
    for m in picks {
        let r = optimize_mode(data, weapon_key, base, target, &OptimizeOptions { mode: Some(m), ..opts.clone() })?;
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

fn optimize_mode(
    data: &GameData,
    weapon_key: &str,
    base: &Build,
    target: &Target,
    opts: &OptimizeOptions,
) -> Result<OptimizeResult, CalcError> {
    let weapon = data
        .weapon(weapon_key)
        .ok_or_else(|| CalcError::new(ErrorCode::UnknownWeapon, format!("no weapon '{weapon_key}'")))?;
    let enemy = resolve_enemy(data, target)?;
    let faction = enemy.as_ref().map_or(Faction::None, |e| e.faction);
    let build = Build { weapon: weapon.id.clone(), mods: vec![], arcane: None, riven: vec![], ..base.clone() };

    let candidates: Vec<&Mod> = data
        .mods
        .iter()
        .filter(|m| m.fits(weapon) && m.modifiers.iter().any(|x| stat_matters(x.stat, faction, opts.allow_faction)))
        .collect();

    let mut ctx = Ctx {
        weapon,
        enemy,
        target,
        build,
        mode: 0,
        candidates,
        evals: 0,
        min_attack_speed: opts.min_attack_speed,
        max_fire_rate: opts.max_fire_rate,
        objective: opts.objective,
        capacity: opts.capacity.clone(),
        evolutions: vec![],
    };

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
    let mode_def = weapon
        .modes
        .get(mode)
        .ok_or_else(|| CalcError::new(ErrorCode::MissingField, format!("{} has no mode {mode}", weapon.name)))?;
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
        let list: Vec<Option<&Arcane>> = if opts.arcane {
            data.arcanes
                .iter()
                .filter(|a| a.slot == slot && (a.behaviour.is_some() || a.modifiers.iter().any(|m| stat_matters(m.stat, faction, opts.allow_faction))))
                .map(Some)
                .collect()
        } else {
            vec![]
        };
        if list.is_empty() { vec![None] } else { list }
    };
    let evo_combos = evolution_combos(weapon, opts.evolutions, faction, opts.allow_faction);

    let fixed: Vec<RivenStat> = opts
        .fixed_riven
        .iter()
        .map(|m| RivenStat { key: m.source.clone(), label: m.source.trim_start_matches("Riven ").to_string(), modifier: m.clone(), spliced: false })
        .collect();
    let structure_slots = if fixed.is_empty() { NORMAL_SLOTS } else { NORMAL_SLOTS - 1 };

    let mut candidates_found: Vec<Structure<'_>> = Vec::new();
    for &a in &arcanes {
        for evos in &evo_combos {
            ctx.evolutions = evos.clone();
            let (m, v) = ctx.search(vec![], a, &fixed, structure_slots, false);
            candidates_found.push(Structure { score: v, arcane: a, evolutions: evos.clone(), mods: m });
        }
    }
    candidates_found.sort_by(|x, y| y.score.total_cmp(&x.score));
    let mut finals: Vec<Structure<'_>> = Vec::new();
    for c in candidates_found.into_iter().take(STRUCTURE_FINALISTS) {
        ctx.evolutions = c.evolutions.clone();
        let (m, v) = ctx.search(c.mods.clone(), c.arcane, &fixed, structure_slots, true);
        finals.push(Structure { score: v, mods: m, ..c });
    }
    finals.sort_by(|x, y| y.score.total_cmp(&x.score));

    let top = finals[0].clone();
    let mut mods = top.mods.clone();
    let mut best = top.score;
    let mut arcane = top.arcane;
    ctx.evolutions = top.evolutions.clone();
    let mut riven: Vec<RivenStat> = fixed.clone();
    let mut negative: Option<RivenPick> = None;

    if fixed.is_empty() && opts.riven {
        let table = data
            .riven
            .as_ref()
            .ok_or_else(|| CalcError::new(ErrorCode::MissingField, "game data has no riven table"))?;
        let ty = RivenType::for_pool(weapon.mod_pool);
        let roll = table.roll_min + (table.roll_max - table.roll_min) * opts.riven_roll.clamp(0.0, 1.0);
        let mut best_riven: Option<(Structure<'_>, Vec<RivenStat>, RivenPick)> = None;
        // The riven can change which structure wins, so try it on the best two.
        for st in finals.iter().take(RIVEN_STRUCTURES) {
            ctx.evolutions = st.evolutions.clone();
            for positives in [3usize, 2] {
                let Some(layout) = table.layout(positives, true) else { continue };
                let Some(neg_def) = table.stats.iter().find(|s| s.stat.is_none() && s.base.contains_key(&ty)) else { continue };
                let pool: Vec<RivenStat> = table
                    .stats
                    .iter()
                    .filter(|s| opts.spliced_riven || !s.spliced)
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
                            },
                        })
                    })
                    .collect();
                let (m, r, v) = ctx.search_riven(st.mods.clone(), st.arcane, &pool, positives);
                let neg = RivenPick {
                    key: neg_def.key.clone(),
                    label: neg_def.label.clone(),
                    value: -neg_def.base[&ty] * table.disposition * layout.negative_mult * roll,
                };
                if best_riven.as_ref().is_none_or(|(b, _, _)| v > b.score) {
                    best_riven = Some((Structure { score: v, mods: m, ..st.clone() }, r, neg));
                }
            }
        }
        if let Some((st, r, neg)) = best_riven {
            mods = st.mods;
            best = st.score;
            arcane = st.arcane;
            ctx.evolutions = st.evolutions;
            riven = r;
            negative = Some(neg);
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
        best = objective_value(opts.objective, m);
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
    } || matches!((opts.max_fire_rate, &final_mode), (Some(max), Some(m)) if m.attack_speed.is_none() && m.fire_rate > max + 1e-9);
    let drain = opts.capacity.as_ref().map(|c| total_drain(&mods, normal_slots, c));

    let fm = final_mode.as_ref();
    Ok(OptimizeResult {
        objective: opts.objective,
        score: best,
        fire_rate: fm.map_or(0.0, |m| m.fire_rate),
        sustained_dps: fm.map_or(0.0, |m| m.sustained_dps),
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
    })
}

#[cfg(test)]
mod tests;
