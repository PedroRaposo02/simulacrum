use super::*;
use serde_json::json;
use wf_calc::compute;

fn modj(id: &str, name: &str, stat: serde_json::Value, value: f64, extra: serde_json::Value) -> serde_json::Value {
    let mut m = json!({
        "id": id, "name": name, "pool": "secondary", "compat": null, "polarity": "madurai",
        "baseDrain": 4, "maxRank": 10, "isExilus": false,
        "modifiers": [{"source": name, "stat": stat, "value": value}]
    });
    if let (Some(o), Some(e)) = (m.as_object_mut(), extra.as_object()) {
        for (k, v) in e {
            o.insert(k.clone(), v.clone());
        }
    }
    m
}

fn fixture() -> GameData {
    let mods = vec![
        modj("hs", "Hornet Strike", json!({"kind": "baseDamage"}), 2.2, json!({})),
        modj("bd", "Barrel Diffusion", json!({"kind": "multishot"}), 1.2, json!({"exclusiveGroup": "ms"})),
        modj("gd", "Galvanized Diffusion", json!({"kind": "multishot"}), 1.1, json!({"exclusiveGroup": "ms"})),
        modj("lt", "Lethal Torrent", json!({"kind": "fireRate"}), 0.6, json!({})),
        modj("ppg", "Primed Pistol Gambit", json!({"kind": "critChance"}), 1.87, json!({})),
        modj("ptc", "Primed Target Cracker", json!({"kind": "critDamage"}), 1.1, json!({"exclusiveGroup": "cd"})),
        modj("tc", "Target Cracker", json!({"kind": "critDamage"}), 0.6, json!({"exclusiveGroup": "cd"})),
        modj("hc", "Heated Charge", json!({"kind": "element", "of": "heat"}), 0.9, json!({})),
        modj("dc", "Deep Freeze", json!({"kind": "element", "of": "cold"}), 0.9, json!({})),
        modj("cc", "Convulsion", json!({"kind": "element", "of": "electricity"}), 0.9, json!({})),
        modj("pp", "Pathogen Rounds", json!({"kind": "element", "of": "toxin"}), 0.9, json!({})),
        modj("gs", "Gunslinger", json!({"kind": "fireRate"}), 0.72, json!({})),
        modj("ex", "Hush", json!({"kind": "statusDuration"}), 0.1, json!({"isExilus": true})),
        modj("mag", "Slip Magazine", json!({"kind": "magazine"}), 0.3, json!({})),
    ];
    serde_json::from_value(json!({
        "version": "test", "generatedAt": "", "sources": {},
        "weapons": [{
            "id": "/Test/Pistol", "name": "Test Pistol", "slot": "secondary", "class": "pistol",
            "family": "Test", "modPool": "secondary",
            "modes": [{
                "name": "Normal Attack", "trigger": "semi", "fireRate": 2.5, "magazine": 12, "reloadS": 2.0,
                "ammoPool": {"kind": "magazine"}, "coverage": "computed",
                "components": [{"name": "Normal Attack", "kind": "direct", "damage": {"impact": 64.0, "slash": 96.0},
                    "critChance": 0.22, "critMult": 2.2, "statusChance": 0.22, "multishot": 1.0}]
            }]
        }],
        "mods": mods,
        "arcanes": [{"id": "ene", "name": "Secondary Enervate", "slot": "secondary", "behaviour": "enervate",
                     "modifiers": [], "description": ""}],
        "enemies": [{"id": "sp-grineer", "name": "Steel Path Grineer", "faction": "grineer", "armor": 2700.0}],
        "riven": {
            "disposition": 1.2, "rollMin": 0.9, "rollMax": 1.1,
            "layouts": [
                {"positives": 2, "negative": true, "positiveMult": 1.2375, "negativeMult": 0.495},
                {"positives": 3, "negative": true, "positiveMult": 0.9375, "negativeMult": 0.75}
            ],
            "stats": [
                {"key": "DMG", "label": "Damage", "stat": {"kind": "baseDamage"}, "base": {"pistol": 2.199}},
                {"key": "MS", "label": "Multishot", "stat": {"kind": "multishot"}, "base": {"pistol": 1.197}},
                {"key": "CD", "label": "Critical Damage", "stat": {"kind": "critDamage"}, "base": {"pistol": 0.9}},
                {"key": "CC", "label": "Critical Chance", "stat": {"kind": "critChance"}, "base": {"pistol": 1.499}},
                {"key": "ZOOM", "label": "Zoom", "stat": null, "base": {"pistol": 0.8}}
            ]
        }
    }))
    .unwrap()
}

fn burst(data: &GameData, build: &Build, target: &Target, mode: usize) -> f64 {
    compute(data, build, target).unwrap().modes[mode].burst_dps
}

#[test]
fn reported_dps_matches_engine() {
    let d = fixture();
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions::default()).unwrap();
    let b = r.to_build(&d, &Build::default());
    assert!((burst(&d, &b, &Target::default(), r.mode_index) - r.burst_dps).abs() < 1e-6 * r.burst_dps);
    assert!(r.mods.len() >= 8, "all normal slots used: {:?}", r.mods);
}

#[test]
fn respects_exclusive_groups_and_skips_useless_mods() {
    let d = fixture();
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions::default()).unwrap();
    assert!(r.mods.contains(&"Primed Target Cracker".to_string()));
    assert!(!r.mods.contains(&"Target Cracker".to_string()));
    assert!(!(r.mods.contains(&"Barrel Diffusion".to_string()) && r.mods.contains(&"Galvanized Diffusion".to_string())));
    assert!(!r.mods.contains(&"Slip Magazine".to_string()), "magazine never helps burst DPS");
}

#[test]
fn beats_or_matches_hand_builds() {
    let d = fixture();
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions::default()).unwrap();
    let hand = Build {
        weapon: "Test Pistol".into(),
        mods: ["Hornet Strike", "Barrel Diffusion", "Lethal Torrent", "Primed Pistol Gambit", "Primed Target Cracker", "Heated Charge", "Deep Freeze", "Gunslinger"]
            .map(String::from)
            .to_vec(),
        ..Default::default()
    };
    assert!(r.burst_dps >= burst(&d, &hand, &Target::default(), 0) * (1.0 - 1e-9));
}

#[test]
fn arcane_is_chosen_when_it_helps() {
    let d = fixture();
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions::default()).unwrap();
    assert_eq!(r.arcane.as_deref(), Some("Secondary Enervate"));
}

#[test]
fn riven_build_is_at_least_as_good_and_uses_seven_normal_slots() {
    let d = fixture();
    let t = Target::default();
    let plain = optimize(&d, "Test Pistol", &Build::default(), &t, &OptimizeOptions::default()).unwrap();
    let riv = optimize(&d, "Test Pistol", &Build::default(), &t, &OptimizeOptions { riven: true, ..Default::default() }).unwrap();
    assert!(riv.burst_dps >= plain.burst_dps);
    assert!(!riv.riven.is_empty() && riv.riven.len() <= 3);
    assert_eq!(riv.riven_negative.as_ref().map(|n| n.key.as_str()), Some("ZOOM"));
    let d2 = d.clone();
    let normal = riv.mods.iter().filter(|m| !d2.find_mod(m).unwrap().is_exilus).count();
    assert!(normal <= 7, "{:?}", riv.mods);
    let b = riv.to_build(&d, &Build::default());
    assert!((burst(&d, &b, &t, riv.mode_index) - riv.burst_dps).abs() < 1e-6 * riv.burst_dps);
}

#[test]
fn max_roll_riven_values() {
    let d = fixture();
    let riv = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions { riven: true, ..Default::default() }).unwrap();
    let layout_mult = if riv.riven.len() == 3 { 0.9375 } else { 1.2375 };
    for p in &riv.riven {
        let base = d.riven.as_ref().unwrap().stats.iter().find(|s| s.key == p.key).unwrap().base[&RivenType::Pistol];
        assert!((p.value - base * 1.2 * layout_mult * 1.1).abs() < 1e-9, "{p:?}");
    }
}

#[test]
fn heavy_attack_modes_are_not_the_default() {
    let mut d = fixture();
    let mut heavy = d.weapons[0].modes[0].clone();
    heavy.name = "Heavy Attack".into();
    heavy.components[0].rules.combo_scaling = true;
    d.weapons[0].modes.push(heavy);
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions::default()).unwrap();
    assert_eq!(r.mode_index, 0);
    let forced = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions { mode: Some(1), ..Default::default() }).unwrap();
    assert!(forced.burst_dps > r.burst_dps);
}

#[test]
fn deterministic() {
    let d = fixture();
    let o = OptimizeOptions { riven: true, ..Default::default() };
    let a = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &o).unwrap();
    let b = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &o).unwrap();
    assert_eq!(a.mods, b.mods);
    assert_eq!(a.burst_dps, b.burst_dps);
}

#[test]
fn exilus_slot_only_takes_exilus_mods() {
    let mut d = fixture();
    // Make the exilus mod strong so the optimizer wants it as a 9th mod.
    let hush = d.mods.iter_mut().find(|m| m.name == "Hush").unwrap();
    hush.modifiers[0].stat = Stat::CritDamage;
    // A real exilus mod drains little, so the build still fits 60 with forma.
    hush.base_drain = 0;
    hush.max_rank = 3;
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions::default()).unwrap();
    assert_eq!(r.mods.len(), 9);
    assert_eq!(r.mods.last().map(String::as_str), Some("Hush"));
}

#[test]
fn realistic_capacity_is_respected() {
    let d = fixture();
    let cap = CapacityOptions { capacity: 60.0, polarities: vec![None; 9], riven_drain: 9.0 };
    let o = OptimizeOptions { capacity: Some(cap.clone()), ..Default::default() };
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &o).unwrap();
    // Every fixture mod drains 4 + 10 = 14 unpolarized: at most 4 fit in 60.
    assert!(r.mods.len() <= 4, "{:?}", r.mods);
    assert!(r.drain.unwrap() <= 60.0);
    let theoretical = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions::default()).unwrap();
    assert!(r.burst_dps < theoretical.burst_dps);
}

#[test]
fn matching_polarities_halve_drain() {
    let d = fixture();
    let m = d.find_mod("Hornet Strike").unwrap();
    assert_eq!(slot_drain(m, None), 14.0);
    assert_eq!(slot_drain(m, Some("madurai")), 7.0);
    assert_eq!(slot_drain(m, Some("naramon")), 18.0);
    let cap = CapacityOptions { capacity: 60.0, polarities: vec![Some("madurai".into()); 9], riven_drain: 9.0 };
    let o = OptimizeOptions { capacity: Some(cap), ..Default::default() };
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &o).unwrap();
    assert_eq!(r.mods.len(), 8, "8 madurai mods at 7 each fit: {:?}", r.mods);
}

#[test]
fn attack_speed_floor_is_met_when_possible() {
    let d = fixture();
    let plain = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions { objective: Objective::Burst, ..Default::default() }).unwrap();
    let o = OptimizeOptions { min_attack_speed: Some(5.5), objective: Objective::Burst, ..Default::default() };
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &o).unwrap();
    let b = r.to_build(&d, &Build::default());
    let fire_rate = compute(&d, &b, &Target::default()).unwrap().modes[0].fire_rate;
    assert!(fire_rate >= 5.5, "fire rate {fire_rate} with {:?}", r.mods);
    assert!(!r.below_attack_speed_floor);
    assert!(r.burst_dps <= plain.burst_dps + 1e-9);
}

#[test]
fn fixed_riven_grades_below_or_at_god_roll() {
    let d = fixture();
    let t = Target::default();
    let god = optimize(&d, "Test Pistol", &Build::default(), &t, &OptimizeOptions { riven: true, ..Default::default() }).unwrap();
    let weak = vec![Modifier {
        source: "Riven Critical Damage".into(),
        stat: Stat::CritDamage,
        value: 0.5,
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
    }];
    let graded = optimize(&d, "Test Pistol", &Build::default(), &t, &OptimizeOptions { fixed_riven: weak, ..Default::default() }).unwrap();
    assert!(graded.burst_dps < god.burst_dps);
    assert_eq!(graded.riven.len(), 1);
    let normal = graded.mods.iter().filter(|m| !d.find_mod(m).unwrap().is_exilus).count();
    assert!(normal <= 7);
}

#[test]
fn objective_per_charge_ignores_fire_rate_and_cap_is_respected() {
    let d = fixture();
    // Viral held at 10 stacks, so fire rate can't add value through faster stacking.
    let t = Target { viral_stacks: Some(10.0), ..Default::default() };
    let burst = optimize(&d, "Test Pistol", &Build::default(), &t, &OptimizeOptions { objective: Objective::Burst, ..Default::default() }).unwrap();
    let per = optimize(&d, "Test Pistol", &Build::default(), &t, &OptimizeOptions { objective: Objective::PerCharge, ..Default::default() }).unwrap();
    assert!(per.per_shot >= burst.per_shot, "damage per magazine favours damage over fire rate");
    assert!(!per.mods.iter().any(|m| m == "Gunslinger"), "{:?}", per.mods);
    // Base 2.5/s, at most +20% -> 3.0/s.
    let capped = optimize(&d, "Test Pistol", &Build::default(), &t, &OptimizeOptions { max_fire_rate_bonus: Some(0.2), objective: Objective::Burst, ..Default::default() }).unwrap();
    assert!(capped.fire_rate <= 3.0 + 1e-9, "fire rate {}", capped.fire_rate);
    assert!(!capped.below_attack_speed_floor);
}

#[test]
fn balanced_objective_ignores_fire_rate_above_the_comfort_cap() {
    let d = fixture();
    let t = Target { viral_stacks: Some(10.0), ..Default::default() };
    let r = optimize(&d, "Test Pistol", &Build::default(), &t, &OptimizeOptions::default()).unwrap();
    assert_eq!(r.objective, Objective::Balanced);
    // Base 2.5/s: fire rate is only worth something up to +150% (6.25/s).
    assert!(r.fire_rate <= 2.5 * (1.0 + BALANCED_FIRE_RATE_BONUS) * 1.2 + 1e-9, "fire rate {} with {:?}", r.fire_rate, r.mods);
}

#[test]
fn riven_ranking_is_sorted_and_relative() {
    let d = fixture();
    let r = rank_rivens(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions::default()).unwrap();
    // 4 damage stats in the fixture's riven table: C(4,3) + C(4,2) = 10 rolls.
    assert_eq!(r.rolls.len(), 10);
    assert!((r.rolls[0].ratio - 1.0).abs() < 1e-12);
    assert!(r.rolls.windows(2).all(|w| w[0].score >= w[1].score));
    assert!(r.rolls.iter().all(|x| x.ratio <= 1.0 + 1e-12 && x.ratio > 0.0));
}

#[test]
fn exilus_dropped_when_build_cannot_fit_even_fully_forma_d() {
    let mut d = fixture();
    // Strong but expensive exilus: 8 mods at 7 (forma'd) + 7 = 63 > 60.
    d.mods.iter_mut().find(|m| m.name == "Hush").unwrap().modifiers[0].stat = Stat::CritDamage;
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions::default()).unwrap();
    assert_eq!(r.mods.len(), 8, "{:?}", r.mods);
}

#[test]
fn explosive_detection_needs_a_sizeable_projectile_explosion() {
    let d = fixture();
    let mut m = d.weapons[0].modes[0].clone();
    assert!(!is_explosive(&m), "no radial component");
    let mut radial = m.components[0].clone();
    radial.kind = wf_data::HitKind::Radial;
    radial.falloff = Some(wf_data::Falloff { start_m: 0.0, end_m: 4.0, reduction: 0.5 });
    m.components.push(radial);
    m.shot = Some("projectile".into());
    assert!(is_explosive(&m));
    m.shot = Some("hitscan".into());
    assert!(!is_explosive(&m), "hitscan rifles with a pop don't count");
    m.shot = Some("projectile".into());
    m.components[1].falloff.as_mut().unwrap().end_m = 2.0;
    assert!(!is_explosive(&m), "2 m pops don't count");
}

#[test]
fn forced_explosion_mod_survives_making_room_for_a_riven() {
    let mut d = fixture();
    // Explosive main attack, and a no-damage radius mod the optimizer must keep.
    let mut radial = d.weapons[0].modes[0].components[0].clone();
    radial.kind = wf_data::HitKind::Radial;
    radial.falloff = Some(wf_data::Falloff { start_m: 0.0, end_m: 4.0, reduction: 0.5 });
    d.weapons[0].modes[0].components.push(radial);
    d.weapons[0].modes[0].shot = Some("projectile".into());
    let mut radius = d.mods[0].clone();
    radius.id = "pf".into();
    radius.name = "Primed Fulmination".into();
    radius.exclusive_group = None;
    radius.is_exilus = false;
    radius.modifiers[0].stat = Stat::StatusDuration;
    d.mods.push(radius);
    d.rules.explosion_radius.insert("secondary".into(), vec!["Primed Fulmination".into()]);
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions { riven: true, ..Default::default() }).unwrap();
    assert!(r.mods.iter().any(|m| m == "Primed Fulmination"), "{:?}", r.mods);
    assert!(!r.riven.is_empty());
}

#[test]
fn locked_mods_stay_and_the_rest_is_searched() {
    let d = fixture();
    let o = OptimizeOptions { locked_mods: vec!["Slip Magazine".into(), "Hush".into()], ..Default::default() };
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &o).unwrap();
    assert!(r.mods.iter().any(|m| m == "Slip Magazine") && r.mods.iter().any(|m| m == "Hush"), "{:?}", r.mods);
    assert!(r.mods.iter().any(|m| m == "Hornet Strike"), "{:?}", r.mods);
    // With a riven too.
    let o = OptimizeOptions { riven: true, ..o };
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &o).unwrap();
    assert!(r.mods.iter().any(|m| m == "Slip Magazine"), "{:?}", r.mods);
    assert!(!r.riven.is_empty());
    // Two mods of one exclusive group can't both be locked.
    let bad = OptimizeOptions { locked_mods: vec!["Barrel Diffusion".into(), "Galvanized Diffusion".into()], ..Default::default() };
    assert!(optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &bad).is_err());
}

#[test]
fn stat_goals_are_reached_before_damage() {
    let d = fixture();
    let t = Target::default();
    let per = OptimizeOptions { objective: Objective::PerShot, ..Default::default() };
    let plain = optimize(&d, "Test Pistol", &Build::default(), &t, &per).unwrap();
    // 15 shots/s is out of reach (2.5 base, +132% at most): the closest build, flagged.
    for (goal, reachable) in [
        (StatGoal { stat: GoalStat::FireRate, value: 0.5, relative: true }, true),
        (StatGoal { stat: GoalStat::FireRate, value: 5.5, relative: false }, true),
        (StatGoal { stat: GoalStat::FireRate, value: 15.0, relative: false }, false),
    ] {
        let o = OptimizeOptions { goals: vec![goal], ..per.clone() };
        let r = optimize(&d, "Test Pistol", &Build::default(), &t, &o).unwrap();
        assert_eq!(r.goals_met, reachable, "{goal:?}: {:?}", r.goals);
        if reachable {
            assert!(r.goals[0].value >= r.goals[0].target - 1e-6, "{:?}", r.goals);
            assert!(r.per_shot <= plain.per_shot + 1e-9);
        } else {
            assert!(r.mods.iter().any(|m| m == "Gunslinger") && r.mods.iter().any(|m| m == "Lethal Torrent"), "{:?}", r.mods);
        }
    }
    // Magazine mods only join the search for a magazine goal.
    assert!(!plain.mods.iter().any(|m| m == "Slip Magazine"));
    let o = OptimizeOptions { goals: vec![StatGoal { stat: GoalStat::Magazine, value: 15.0, relative: false }], ..per };
    let r = optimize(&d, "Test Pistol", &Build::default(), &t, &o).unwrap();
    assert!(r.goals_met && r.mods.iter().any(|m| m == "Slip Magazine"), "{:?} {:?}", r.mods, r.goals);
}

#[test]
fn riven_shards_together_equal_one_search() {
    let d = fixture();
    let t = Target::default();
    let o = OptimizeOptions { riven: true, mode: Some(0), ..Default::default() };
    let full = optimize(&d, "Test Pistol", &Build::default(), &t, &o).unwrap();
    for count in [2usize, 3, 8] {
        let shards: Vec<OptimizeResult> = (0..count)
            .map(|index| optimize(&d, "Test Pistol", &Build::default(), &t, &OptimizeOptions { riven_shard: Some(Shard { index, count }), ..o.clone() }).unwrap())
            .filter(|r| !r.shard_empty)
            .collect();
        let best = shards
            .iter()
            .reduce(|a, b| if b.search_score > a.search_score || (b.search_score == a.search_score && b.riven_job < a.riven_job) { b } else { a })
            .unwrap();
        assert_eq!((&best.mods, best.score.to_bits()), (&full.mods, full.score.to_bits()), "{count} shards");
        assert_eq!(best.riven.iter().map(|r| &r.key).collect::<Vec<_>>(), full.riven.iter().map(|r| &r.key).collect::<Vec<_>>());
    }
}

#[test]
fn a_seed_never_makes_the_result_worse() {
    let d = fixture();
    let t = Target::default();
    for riven in [false, true] {
        let plain = optimize(&d, "Test Pistol", &Build::default(), &t, &OptimizeOptions { riven, ..Default::default() }).unwrap();
        // A poor seed and the best build as a seed.
        for mods in [vec!["Slip Magazine".to_string(), "Hush".to_string()], plain.mods.clone()] {
            let seed = SeedBuild { mode_index: 0, mods, arcane: plain.arcane.clone(), riven: plain.riven.iter().map(|r| r.key.clone()).collect(), ..Default::default() };
            let r = optimize(&d, "Test Pistol", &Build::default(), &t, &OptimizeOptions { riven, seed: Some(seed), ..Default::default() }).unwrap();
            assert!(r.score >= plain.score * (1.0 - 1e-9), "riven {riven}: {} < {}", r.score, plain.score);
        }
    }
}
