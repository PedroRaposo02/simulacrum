use crate::types::*;
use crate::compute;
use serde::{Deserialize, Serialize};
use wf_data::{Coverage, GameData, ModPool, Weapon};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepEntry {
    pub weapon_id: String,
    pub weapon: String,
    pub mode: String,
    pub build: String,
    pub enemy: String,
    pub burst_dps: f64,
    pub sustained_dps: f64,
    pub coverage: Coverage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepFailure {
    pub fingerprint: String,
    pub weapon: String,
    pub build: String,
    pub error: CalcError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepReport {
    pub data_version: String,
    pub weapons: usize,
    pub attack_modes: usize,
    pub entries: Vec<SweepEntry>,
    pub failures: Vec<SweepFailure>,
    #[serde(default)]
    /// Results far above the median of the same build and enemy: (entry, ratio to median).
    pub outliers: Vec<(SweepEntry, f64)>,
}

const OUTLIER_RATIO: f64 = 25.0;

fn outliers(entries: &[SweepEntry]) -> Vec<(SweepEntry, f64)> {
    let mut groups: std::collections::BTreeMap<(String, String), Vec<f64>> = Default::default();
    for e in entries {
        groups.entry((e.build.clone(), e.enemy.clone())).or_default().push(e.burst_dps);
    }
    let medians: std::collections::BTreeMap<_, f64> = groups
        .into_iter()
        .map(|(k, mut v)| {
            v.sort_by(|a, b| a.total_cmp(b));
            (k, v[v.len() / 2])
        })
        .collect();
    entries
        .iter()
        .filter_map(|e| {
            let m = medians[&(e.build.clone(), e.enemy.clone())];
            let ratio = e.burst_dps / m.max(f64::MIN_POSITIVE);
            (ratio > OUTLIER_RATIO).then(|| (e.clone(), ratio))
        })
        .collect()
}

/// Reference builds per mod pool: (name, mods). Missing or incompatible mods are skipped.
fn reference_builds(pool: Option<ModPool>) -> Vec<(&'static str, Vec<&'static str>)> {
    let (crit, status): (&[&str], &[&str]) = match pool {
        Some(ModPool::Secondary) => (
            &["Hornet Strike", "Barrel Diffusion", "Pistol Gambit", "Target Cracker", "Gunslinger"],
            &["Hornet Strike", "Barrel Diffusion", "Sure Shot", "Heated Charge", "Convulsion"],
        ),
        Some(ModPool::Shotgun) => (
            &["Point Blank", "Hell's Chamber", "Blunderbuss", "Ravage", "Shotgun Spazz"],
            &["Point Blank", "Hell's Chamber", "Shotgun Savvy", "Incendiary Coat", "Charged Shell"],
        ),
        Some(ModPool::Primary) | Some(ModPool::Companion) => (
            &["Serration", "Split Chamber", "Point Strike", "Vital Sense", "Speed Trigger"],
            &["Serration", "Split Chamber", "Rifle Aptitude", "Hellfire", "Stormbringer"],
        ),
        Some(ModPool::Melee) => (
            &["Pressure Point", "True Steel", "Organ Shatter", "Fury", "Blood Rush"],
            &["Pressure Point", "Condition Overload", "Weeping Wounds", "Molten Impact", "North Wind"],
        ),
        _ => (&[], &[]),
    };
    vec![("unmodded", vec![]), ("generic crit", crit.to_vec()), ("generic status", status.to_vec())]
}

fn pool_of(w: &Weapon) -> Option<ModPool> {
    Some(w.mod_pool)
}

pub fn sweep(data: &GameData, enemies: &[Option<String>]) -> SweepReport {
    let mut entries = Vec::new();
    let mut failures = Vec::new();
    let mut attack_modes = 0;
    for w in &data.weapons {
        attack_modes += w.modes.len();
        for (bname, mods) in reference_builds(pool_of(w)) {
            let mods: Vec<String> = mods
                .into_iter()
                .filter(|m| data.find_mod(m).is_some_and(|x| x.fits(w)))
                .map(String::from)
                .collect();
            if bname != "unmodded" && mods.is_empty() {
                continue;
            }
            let build = Build { weapon: w.id.clone(), mods, ..Default::default() };
            for enemy in enemies {
                let target = Target { enemy: enemy.clone(), ..Default::default() };
                match compute(data, &build, &target) {
                    Ok(res) => {
                        for f in res.failed_modes {
                            let fp = format!("{}:{}:{:?}", w.id, f.mode, f.error.code);
                            if !failures.iter().any(|x: &SweepFailure| x.fingerprint == fp) {
                                failures.push(SweepFailure { fingerprint: fp, weapon: w.name.clone(), build: bname.into(), error: f.error });
                            }
                        }
                        for m in res.modes {
                            let bad = !(m.burst_dps > 0.0) || !m.burst_dps.is_finite();
                            if bad {
                                failures.push(SweepFailure {
                                    fingerprint: format!("{}:{}:nonPositive", w.id, m.mode),
                                    weapon: w.name.clone(),
                                    build: bname.into(),
                                    error: CalcError::new(ErrorCode::InvalidValue, format!("burst DPS {}", m.burst_dps)),
                                });
                            }
                            entries.push(SweepEntry {
                                weapon_id: w.id.clone(),
                                weapon: w.name.clone(),
                                mode: m.mode,
                                build: bname.into(),
                                enemy: res.target.clone(),
                                burst_dps: m.burst_dps,
                                sustained_dps: m.sustained_dps,
                                coverage: m.coverage,
                            });
                        }
                    }
                    Err(e) => {
                        let fp = format!("{}:{:?}", w.id, e.code);
                        if !failures.iter().any(|f: &SweepFailure| f.fingerprint == fp) {
                            failures.push(SweepFailure { fingerprint: fp, weapon: w.name.clone(), build: bname.into(), error: e });
                        }
                    }
                }
            }
        }
    }
    let outliers = outliers(&entries);
    SweepReport { data_version: data.version.clone(), weapons: data.weapons.len(), attack_modes, entries, failures, outliers }
}

/// Entries whose DPS moved by more than `threshold` (fraction) between two reports.
pub fn diff(old: &SweepReport, new: &SweepReport, threshold: f64) -> Vec<(SweepEntry, f64)> {
    new.entries
        .iter()
        .filter_map(|n| {
            let o = old.entries.iter().find(|o| {
                o.weapon_id == n.weapon_id && o.mode == n.mode && o.build == n.build && o.enemy == n.enemy
            })?;
            let change = if o.burst_dps > 0.0 { n.burst_dps / o.burst_dps - 1.0 } else { f64::INFINITY };
            (change.abs() > threshold).then(|| (n.clone(), change))
        })
        .collect()
}
