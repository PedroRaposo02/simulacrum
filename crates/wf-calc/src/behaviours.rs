/// Deterministic RNG so native and WASM runs give identical results for the same seed.
pub struct SplitMix64(u64);

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Behaviours are mechanics a stat line can't express. Each returns a flat crit chance
/// bonus (the only output needed so far) plus a description for the explanation tree.
pub struct BehaviourEffect {
    pub crit_chance_flat: f64,
    pub detail: String,
}

pub fn apply(id: &str, modded_crit_chance: f64) -> Option<BehaviourEffect> {
    match id {
        "enervate" => {
            let avg = enervate_cached(modded_crit_chance);
            Some(BehaviourEffect {
                crit_chance_flat: avg - modded_crit_chance,
                detail: format!(
                    "Simulated 200k hits: +10% crit chance per hit, resets after 6 orange-or-better crits; average crit chance {:.2}%",
                    avg * 100.0
                ),
            })
        }
        _ => None,
    }
}

thread_local! {
    static ENERVATE: std::cell::RefCell<std::collections::HashMap<u64, f64>> = Default::default();
}

/// The optimizer asks for the same crit chance many times; the simulation is seeded, so caching is exact.
fn enervate_cached(cc: f64) -> f64 {
    ENERVATE.with(|c| {
        *c.borrow_mut()
            .entry(cc.to_bits())
            .or_insert_with(|| enervate_average_cc(cc, 0.10, 6, 200_000, 0xE7E2))
    })
}

/// Secondary/Primary Enervate: every hit adds `step` flat crit chance; after `resets_after`
/// big crits (tier >= 2) the bonus resets. Returns the average crit chance over all hits.
pub fn enervate_average_cc(base: f64, step: f64, resets_after: u32, hits: u32, seed: u64) -> f64 {
    let mut rng = SplitMix64::new(seed);
    let (mut stacks, mut big, mut total) = (0u32, 0u32, 0.0);
    for _ in 0..hits {
        let cc = base + step * stacks as f64;
        total += cc;
        let tier = cc.floor() + if rng.next_f64() < cc.fract() { 1.0 } else { 0.0 };
        stacks += 1;
        if tier >= 2.0 {
            big += 1;
            if big >= resets_after {
                stacks = 0;
                big = 0;
            }
        }
    }
    total / hits as f64
}

/// Inputs for the joint Enervate + Overwhelming Attrition simulation (either may be absent).
#[derive(Debug, Clone, Copy)]
pub struct AttritionInput {
    /// Modded crit chance before Enervate.
    pub crit_chance: f64,
    /// Status chance per hit (>= 1 always procs).
    pub status_chance: f64,
    pub hits_per_s: f64,
    pub enervate: bool,
    /// (max stacks, stack duration in seconds) when Overwhelming Attrition is active.
    pub overwhelming: Option<(u32, f64)>,
}

#[derive(Debug, Clone, Copy)]
pub struct AttritionOut {
    pub avg_crit_chance: f64,
    pub avg_stacks: f64,
}

thread_local! {
    static ATTRITION: std::cell::RefCell<std::collections::HashMap<[u64; 5], AttritionOut>> = Default::default();
}

const ATTRITION_HITS: u32 = 60_000;

/// Simulates hits in time order. Enervate: +10% crit per hit, reset after 6 orange-or-better crits.
/// Overwhelming Attrition: a hit that neither crits nor procs status adds a stack; stacks expire
/// one at a time, `duration` after the last refresh. Averages are over hits (cached, seeded).
pub fn attrition(input: AttritionInput) -> AttritionOut {
    let key = [
        input.crit_chance.to_bits(),
        input.status_chance.to_bits(),
        input.hits_per_s.to_bits(),
        u64::from(input.enervate),
        input.overwhelming.map_or(0, |(m, d)| (u64::from(m) << 32) ^ d.to_bits()),
    ];
    if let Some(v) = ATTRITION.with(|c| c.borrow().get(&key).copied()) {
        return v;
    }
    let mut rng = SplitMix64::new(0xA77);
    let dt = 1.0 / input.hits_per_s.max(1e-6);
    let (mut enervate_stacks, mut big) = (0u32, 0u32);
    let (mut stacks, mut expire, mut t) = (0u32, 0.0f64, 0.0f64);
    let (mut sum_cc, mut sum_stacks) = (0.0, 0.0);
    for _ in 0..ATTRITION_HITS {
        if let Some((_, duration)) = input.overwhelming {
            while stacks > 0 && t >= expire {
                stacks -= 1;
                expire += duration;
            }
        }
        let cc = input.crit_chance + if input.enervate { 0.10 * enervate_stacks as f64 } else { 0.0 };
        sum_cc += cc;
        sum_stacks += stacks as f64;
        let tier = cc.floor() + if rng.next_f64() < cc.fract() { 1.0 } else { 0.0 };
        let status = rng.next_f64() < input.status_chance;
        if let Some((max, duration)) = input.overwhelming {
            if tier < 1.0 && !status {
                stacks = (stacks + 1).min(max);
                expire = t + duration;
            }
        }
        if input.enervate {
            enervate_stacks += 1;
            if tier >= 2.0 {
                big += 1;
                if big >= 6 {
                    enervate_stacks = 0;
                    big = 0;
                }
            }
        }
        t += dt;
    }
    let out = AttritionOut { avg_crit_chance: sum_cc / ATTRITION_HITS as f64, avg_stacks: sum_stacks / ATTRITION_HITS as f64 };
    ATTRITION.with(|c| c.borrow_mut().insert(key, out));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enervate_matches_laetum_analysis() {
        // Plan golden value: simulation gave 113.9% (wiki fit 113.45%) at 22% crit chance.
        let avg = enervate_average_cc(0.22, 0.10, 6, 400_000, 1);
        assert!((avg - 1.139).abs() < 0.01, "average crit chance was {avg}");
    }

    #[test]
    fn overwhelming_attrition_needs_non_crit_non_status_hits() {
        let oa = Some((3, 10.0));
        // Low crit, low status, fast fire: almost always 3 stacks.
        let easy = attrition(AttritionInput { crit_chance: 0.2, status_chance: 0.2, hits_per_s: 10.0, enervate: false, overwhelming: oa });
        assert!(easy.avg_stacks > 2.9, "{easy:?}");
        // Guaranteed crits never trigger it.
        let crit = attrition(AttritionInput { crit_chance: 1.0, status_chance: 0.0, hits_per_s: 10.0, enervate: false, overwhelming: oa });
        assert_eq!(crit.avg_stacks, 0.0);
        // Guaranteed status never triggers it.
        let stat = attrition(AttritionInput { crit_chance: 0.0, status_chance: 1.0, hits_per_s: 10.0, enervate: false, overwhelming: oa });
        assert_eq!(stat.avg_stacks, 0.0);
    }

    #[test]
    fn enervate_resets_keep_attrition_alive() {
        // High crit alone would starve it; Enervate's resets drop crit back to base periodically.
        let both = attrition(AttritionInput { crit_chance: 0.5, status_chance: 0.0, hits_per_s: 10.0, enervate: true, overwhelming: Some((3, 10.0)) });
        assert!(both.avg_stacks > 2.0, "{both:?}");
        let alone = enervate_average_cc(0.5, 0.10, 6, 200_000, 7);
        assert!((both.avg_crit_chance - alone).abs() < 0.02);
    }

    #[test]
    fn rng_is_deterministic() {
        let a: Vec<u64> = (0..4).scan(SplitMix64::new(7), |r, _| Some(r.next_u64())).collect();
        let b: Vec<u64> = (0..4).scan(SplitMix64::new(7), |r, _| Some(r.next_u64())).collect();
        assert_eq!(a, b);
    }
}
