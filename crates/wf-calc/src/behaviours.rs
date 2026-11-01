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
            let avg = enervate_average_cc(modded_crit_chance, 0.10, 6, 200_000, 0xE7E2);
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
    fn rng_is_deterministic() {
        let a: Vec<u64> = (0..4).scan(SplitMix64::new(7), |r, _| Some(r.next_u64())).collect();
        let b: Vec<u64> = (0..4).scan(SplitMix64::new(7), |r, _| Some(r.next_u64())).collect();
        assert_eq!(a, b);
    }
}
