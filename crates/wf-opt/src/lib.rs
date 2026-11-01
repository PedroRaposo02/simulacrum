//! Build optimizer: greedy fill, then best-improvement local search over mod swaps and element
//! order, then arcane choice, then an optional theoretical riven searched jointly with the mods.

use serde::{Deserialize, Serialize};
use wf_calc::{evaluate, resolve_enemy, Build, CalcError, ErrorCode, Resolved, Target};
use wf_data::{Arcane, EnemyProfile, Faction, GameData, Mod, Modifier, RivenType, Stat, Weapon};

const NORMAL_SLOTS: usize = 8;
const MAX_PASSES: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OptimizeOptions {
    /// Attack mode to optimize; None picks the mode with the highest unmodded burst DPS.
    pub mode: Option<usize>,
    pub riven: bool,
    pub arcane: bool,
    /// Riven roll position in [0, 1] between the minimum and maximum roll.
    pub riven_roll: f64,
}

impl Default for OptimizeOptions {
    fn default() -> Self {
        Self { mode: None, riven: false, arcane: true, riven_roll: 1.0 }
    }
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
}

impl OptimizeResult {
    /// The result as an engine build (riven picks converted to modifiers).
    pub fn to_build(&self, data: &GameData, base: &Build) -> Build {
        Build {
            weapon: self.weapon_id.clone(),
            mods: self.mods.clone(),
            arcane: self.arcane.clone(),
            riven: riven_modifiers(data, &self.riven),
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
            })
        })
        .collect()
}

#[derive(Clone)]
struct RivenStat {
    key: String,
    label: String,
    modifier: Modifier,
}

struct Ctx<'a> {
    weapon: &'a Weapon,
    enemy: Option<EnemyProfile>,
    target: &'a Target,
    build: Build,
    mode: usize,
    candidates: Vec<&'a Mod>,
    evals: u64,
}

impl<'a> Ctx<'a> {
    fn eval(&mut self, mods: &[&'a Mod], arcane: Option<&'a Arcane>, riven: &[RivenStat]) -> f64 {
        self.evals += 1;
        self.build.riven = riven.iter().map(|r| r.modifier.clone()).collect();
        let r = Resolved { weapon: self.weapon, mods: mods.to_vec(), arcane, enemy: self.enemy.clone(), warnings: vec![] };
        match evaluate(&r, &self.build, self.target, self.mode) {
            Ok(v) if v.is_finite() => v,
            _ => f64::NEG_INFINITY,
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
        for (i, a) in mods.iter().enumerate() {
            for b in &mods[i + 1..] {
                if a.id == b.id || (a.exclusive_group.is_some() && a.exclusive_group == b.exclusive_group) {
                    return false;
                }
            }
        }
        true
    }

    /// Greedy fill followed by best-improvement local search (swap, add, element reorder).
    fn search_mods(
        &mut self,
        start: Vec<&'a Mod>,
        arcane: Option<&'a Arcane>,
        riven: &[RivenStat],
        normal_slots: usize,
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
        for _ in 0..MAX_PASSES {
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

fn stat_matters(stat: Stat, faction: Faction) -> bool {
    match stat {
        Stat::Magazine | Stat::ReloadSpeed => false,
        Stat::FactionDamage(f) => f == faction,
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

pub fn optimize(
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
        .filter(|m| m.fits(weapon) && m.modifiers.iter().any(|x| stat_matters(x.stat, faction)))
        .collect();

    let mut ctx = Ctx { weapon, enemy, target, build, mode: 0, candidates, evals: 0 };

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
        let r = Resolved { weapon, mods: vec![], arcane: None, enemy: ctx.enemy.clone(), warnings: vec![] };
        return Err(match evaluate(&r, &ctx.build, target, mode) {
            Err(e) => e,
            Ok(v) => CalcError::new(ErrorCode::NonFinite, format!("{} / {} gives {v}", weapon.name, mode_def.name)),
        });
    }

    let (mut mods, mut best) = ctx.search_mods(vec![], None, &[], NORMAL_SLOTS);

    let mut arcane: Option<&Arcane> = None;
    if opts.arcane {
        let slot = arcane_slot(weapon);
        let arcanes: Vec<&Arcane> = data
            .arcanes
            .iter()
            .filter(|a| a.slot == slot && (a.behaviour.is_some() || a.modifiers.iter().any(|m| stat_matters(m.stat, faction))))
            .collect();
        for a in arcanes {
            let v = ctx.eval(&mods, Some(a), &[]);
            if v > best * (1.0 + 1e-9) {
                best = v;
                arcane = Some(a);
            }
        }
        if arcane.is_some() {
            let (m, v) = ctx.search_mods(mods.clone(), arcane, &[], NORMAL_SLOTS);
            if v >= best {
                mods = m;
                best = v;
            }
        }
    }

    let mut riven: Vec<RivenStat> = vec![];
    let mut negative: Option<RivenPick> = None;
    if opts.riven {
        let table = data
            .riven
            .as_ref()
            .ok_or_else(|| CalcError::new(ErrorCode::MissingField, "game data has no riven table"))?;
        let ty = RivenType::for_pool(weapon.mod_pool);
        let roll = table.roll_min + (table.roll_max - table.roll_min) * opts.riven_roll.clamp(0.0, 1.0);
        let mut best_riven: Option<(Vec<&Mod>, Vec<RivenStat>, f64, RivenPick)> = None;
        for positives in [3usize, 2] {
            let Some(layout) = table.layout(positives, true) else { continue };
            let Some(neg_def) = table.stats.iter().find(|s| s.stat.is_none() && s.base.contains_key(&ty)) else { continue };
            let pool: Vec<RivenStat> = table
                .stats
                .iter()
                .filter_map(|s| {
                    let stat = s.stat?;
                    let base = *s.base.get(&ty)?;
                    stat_matters(stat, faction).then(|| RivenStat {
                        key: s.key.clone(),
                        label: s.label.clone(),
                        modifier: Modifier {
                            source: format!("Riven {}", s.label),
                            stat,
                            value: base * table.disposition * layout.positive_mult * roll,
                            max_stacks: 1,
                            applies_to: wf_data::ComponentFilter::All,
                            condition: wf_data::Condition::Always,
                            per: None,
                        },
                    })
                })
                .collect();
            let (m, r, v) = ctx.search_riven(mods.clone(), arcane, &pool, positives);
            let neg = RivenPick {
                key: neg_def.key.clone(),
                label: neg_def.label.clone(),
                value: -neg_def.base[&ty] * table.disposition * layout.negative_mult * roll,
            };
            if best_riven.as_ref().is_none_or(|(_, _, bv, _)| v > *bv) {
                best_riven = Some((m, r, v, neg));
            }
        }
        if let Some((m, r, v, neg)) = best_riven {
            mods = m;
            riven = r;
            best = v;
            negative = Some(neg);
        }
    }

    // Marginal value of each piece.
    let mut marginal = Vec::new();
    for i in 0..mods.len() {
        let mut next = mods.clone();
        next.remove(i);
        let v = ctx.eval(&next, arcane, &riven);
        marginal.push(Marginal { label: mods[i].name.clone(), kind: "mod".into(), loss: 1.0 - v / best });
    }
    for i in 0..riven.len() {
        let mut next = riven.clone();
        next.remove(i);
        let v = ctx.eval(&mods, arcane, &next);
        marginal.push(Marginal { label: format!("Riven {}", riven[i].label), kind: "riven".into(), loss: 1.0 - v / best });
    }
    if let Some(a) = arcane {
        let v = ctx.eval(&mods, None, &riven);
        marginal.push(Marginal { label: a.name.clone(), kind: "arcane".into(), loss: 1.0 - v / best });
    }
    marginal.sort_by(|a, b| b.loss.total_cmp(&a.loss));

    Ok(OptimizeResult {
        weapon_id: weapon.id.clone(),
        weapon: weapon.name.clone(),
        mode: mode_def.name.clone(),
        mode_index: mode,
        burst_dps: best,
        mods: mods.iter().map(|m| m.name.clone()).collect(),
        arcane: arcane.map(|a| a.name.clone()),
        riven: riven
            .iter()
            .map(|r| RivenPick { key: r.key.clone(), label: r.label.clone(), value: r.modifier.value })
            .collect(),
        riven_negative: negative,
        marginal,
        evaluations: ctx.evals,
    })
}

#[cfg(test)]
mod tests;
