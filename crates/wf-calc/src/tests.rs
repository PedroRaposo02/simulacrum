use crate::*;
use serde_json::json;
use wf_data::GameData;

fn fixture() -> GameData {
    serde_json::from_value(json!({
        "version": "test", "generatedAt": "", "sources": {},
        "weapons": [{
            "id": "/Test/Laetum", "name": "Laetum", "slot": "secondary", "class": "pistol", "family": "Laetum", "modPool": "secondary",
            "modes": [{
                "name": "Normal Attack", "trigger": "semi", "fireRate": 2.5, "magazine": 12, "reloadS": 2.0,
                "ammoPool": {"kind": "magazine"}, "coverage": "computed",
                "components": [{"name": "Normal Attack", "kind": "direct",
                    "damage": {"impact": 64.0, "slash": 96.0},
                    "critChance": 0.22, "critMult": 2.2, "statusChance": 0.22, "multishot": 1.0}]
            }, {
                "name": "Incarnon Form", "trigger": "auto", "fireRate": 6.67, "magazine": null, "reloadS": 0.0,
                "ammoPool": {"kind": "incarnon", "rounds": 40, "recharge_s": 2.0}, "coverage": "computed",
                "components": [
                    {"name": "Direct", "kind": "direct", "damage": {"impact": 100.0},
                     "critChance": 0.22, "critMult": 2.2, "statusChance": 0.22, "multishot": 1.0},
                    {"name": "Radial", "kind": "radial", "damage": {"radiation": 300.0},
                     "critChance": 0.22, "critMult": 2.2, "statusChance": 0.22, "multishot": 1.0,
                     "rules": {"canHeadshot": false, "receivesMultishot": true}}]
            }]
        }],
        "mods": [
            {"id": "hs", "name": "Hornet Strike", "pool": "secondary", "compat": null, "polarity": "madurai",
             "baseDrain": 2, "maxRank": 10, "isExilus": false,
             "modifiers": [{"source": "Hornet Strike", "stat": {"kind": "baseDamage"}, "value": 2.2}]},
            {"id": "hc", "name": "Heated Charge", "pool": "secondary", "compat": null, "polarity": "naramon",
             "baseDrain": 4, "maxRank": 5, "isExilus": false,
             "modifiers": [{"source": "Heated Charge", "stat": {"kind": "element", "of": "heat"}, "value": 0.9}]},
            {"id": "cs", "name": "Deep Freeze", "pool": "secondary", "compat": null, "polarity": "naramon",
             "baseDrain": 4, "maxRank": 5, "isExilus": false,
             "modifiers": [{"source": "Deep Freeze", "stat": {"kind": "element", "of": "cold"}, "value": 0.9}]},
            {"id": "ptc", "name": "Primed Target Cracker", "pool": "secondary", "compat": null, "polarity": "madurai",
             "baseDrain": 4, "maxRank": 10, "isExilus": false, "exclusiveGroup": "pistol-crit-damage",
             "modifiers": [{"source": "Primed Target Cracker", "stat": {"kind": "critDamage"}, "value": 1.1}]},
            {"id": "tc", "name": "Target Cracker", "pool": "secondary", "compat": null, "polarity": "madurai",
             "baseDrain": 2, "maxRank": 5, "isExilus": false, "exclusiveGroup": "pistol-crit-damage",
             "modifiers": [{"source": "Target Cracker", "stat": {"kind": "critDamage"}, "value": 0.6}]},
            {"id": "gd", "name": "Galvanized Diffusion", "pool": "secondary", "compat": null, "polarity": "madurai",
             "baseDrain": 4, "maxRank": 10, "isExilus": false,
             "modifiers": [
                {"source": "Galvanized Diffusion", "stat": {"kind": "multishot"}, "value": 1.1},
                {"source": "Galvanized Diffusion (on kill)", "stat": {"kind": "multishot"}, "value": 0.3,
                 "maxStacks": 4, "condition": "onKill"}]},
            {"id": "rifle", "name": "Serration", "pool": "primary", "compat": null, "polarity": "madurai",
             "baseDrain": 4, "maxRank": 10, "isExilus": false,
             "modifiers": [{"source": "Serration", "stat": {"kind": "baseDamage"}, "value": 1.65}]}
        ],
        "arcanes": [{"id": "ene", "name": "Secondary Enervate", "slot": "secondary", "behaviour": "enervate",
                     "modifiers": [], "description": ""}],
        "enemies": [{"id": "sp-grineer", "name": "Steel Path Grineer", "faction": "grineer", "armor": 2700.0}]
    }))
    .unwrap()
}

fn run(mods: &[&str], target: Target) -> BuildResult {
    let build = Build { weapon: "Laetum".into(), mods: mods.iter().map(|s| s.to_string()).collect(), ..Default::default() };
    compute(&fixture(), &build, &target).unwrap()
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-6 * b.abs().max(1.0)
}

#[test]
fn unmodded_expected_shot() {
    let r = run(&[], Target::default());
    let m = &r.modes[0];
    assert!(close(m.per_shot, 160.0 * (1.0 + 0.22 * 1.2)));
    assert!(close(m.burst_dps, m.per_shot * 2.5));
    // 12 rounds over 12/2.5 s + 2 s reload.
    assert!(close(m.sustained_dps, m.per_shot * 12.0 / (12.0 / 2.5 + 2.0)));
}

#[test]
fn base_damage_pool_is_additive() {
    let m = &run(&["Hornet Strike"], Target::default()).modes[0];
    assert!(close(m.per_shot, 160.0 * 3.2 * 1.264));
}

#[test]
fn elements_combine_and_quantize() {
    let m = &run(&["Heated Charge", "Deep Freeze"], Target::default()).modes[0];
    let d = &m.components[0].damage;
    // 0.9 + 0.9 of 160 = 288 Blast, which is a multiple of 160/16 = 10 after rounding.
    assert_eq!(d.get(&wf_data::DamageType::Blast).copied(), Some(290.0));
    assert!(d.get(&wf_data::DamageType::Heat).is_none());
}

#[test]
fn exclusive_mods_rejected() {
    let build = Build { weapon: "Laetum".into(), mods: vec!["Target Cracker".into(), "Primed Target Cracker".into()], ..Default::default() };
    let e = compute(&fixture(), &build, &Target::default()).unwrap_err();
    assert_eq!(e.code, ErrorCode::ExclusiveMods);
}

#[test]
fn incompatible_mod_rejected() {
    let build = Build { weapon: "Laetum".into(), mods: vec!["Serration".into()], ..Default::default() };
    assert_eq!(compute(&fixture(), &build, &Target::default()).unwrap_err().code, ErrorCode::IncompatibleMod);
}

#[test]
fn conditional_stacks_follow_uptime() {
    let mut build = Build { weapon: "Laetum".into(), mods: vec!["Galvanized Diffusion".into()], ..Default::default() };
    let full = compute(&fixture(), &build, &Target::default()).unwrap();
    assert!(close(full.modes[0].components[0].projectiles, 1.0 + 1.1 + 1.2));
    build.conditions.conditional_uptime = 0.0;
    let none = compute(&fixture(), &build, &Target::default()).unwrap();
    assert!(close(none.modes[0].components[0].projectiles, 2.1));
}

#[test]
fn armor_cap_gives_ninety_percent_dr() {
    let t = Target { enemy: Some("sp-grineer".into()), heat_active: Some(false), corrosive_stacks: Some(0.0), viral_stacks: Some(0.0), ..Default::default() };
    let m = &run(&[], t).modes[0];
    assert!(close(m.per_shot, m.per_shot_raw * 0.1));
}

#[test]
fn full_strip_removes_dr_and_viral_scales() {
    let t = Target { enemy: Some("sp-grineer".into()), armor_strip: 1.0, viral_stacks: Some(10.0), ..Default::default() };
    let m = &run(&[], t).modes[0];
    assert!(close(m.per_shot, m.per_shot_raw * 4.25));
}

#[test]
fn radial_cannot_headshot() {
    let mut build = Build { weapon: "Laetum".into(), ..Default::default() };
    build.conditions.headshot_share = 1.0;
    let r = compute(&fixture(), &build, &Target::default()).unwrap();
    let inc = &r.modes[1];
    let m = 1.0 + 0.22 * 1.2;
    let direct = 100.0 * 2.0 * (2.0 * m - (1.0 - 0.22));
    assert!(close(inc.components[0].per_projectile_raw, direct));
    assert!(close(inc.components[1].per_projectile_raw, 300.0 * m));
}

#[test]
fn incarnon_charge_and_sustained() {
    let inc = &run(&[], Target::default()).modes[1];
    assert!(close(inc.per_charge.unwrap(), inc.per_shot * 40.0));
    assert!(close(inc.sustained_dps, inc.per_shot * 40.0 / (40.0 / 6.67 + 2.0)));
}

#[test]
fn enervate_adds_flat_crit() {
    let build = Build { weapon: "Laetum".into(), arcane: Some("Secondary Enervate".into()), ..Default::default() };
    let r = compute(&fixture(), &build, &Target::default()).unwrap();
    let cc = r.modes[0].components[0].crit_chance;
    assert!((cc - 1.139).abs() < 0.01, "{cc}");
}

#[test]
fn zero_crit_chance_has_no_crit_bonus() {
    let mut d = fixture();
    d.weapons[0].modes[0].components[0].crit_chance = 0.0;
    let r = compute(&d, &Build { weapon: "Laetum".into(), ..Default::default() }, &Target::default()).unwrap();
    assert!(close(r.modes[0].per_shot, 160.0));
}

#[test]
fn damage_mod_never_lowers_raw_dps() {
    let mut d = fixture();
    let mut last = 0.0;
    for step in 0..40 {
        d.mods[0].modifiers[0].value = step as f64 * 0.1;
        let r = compute(&d, &Build { weapon: "Laetum".into(), mods: vec!["Hornet Strike".into()], ..Default::default() }, &Target::default()).unwrap();
        assert!(r.modes[0].burst_dps_raw >= last);
        last = r.modes[0].burst_dps_raw;
    }
}

#[test]
fn crit_multiplier_linear_in_crit_chance() {
    let mut d = fixture();
    let mut vals = vec![];
    for cc in [0.5, 1.5, 2.5] {
        d.weapons[0].modes[0].components[0].crit_chance = cc;
        let r = compute(&d, &Build { weapon: "Laetum".into(), ..Default::default() }, &Target::default()).unwrap();
        vals.push(r.modes[0].per_shot);
    }
    assert!(close(vals[1] - vals[0], vals[2] - vals[1]));
}

#[test]
fn outsourced_viral_never_lowers_own_stacks() {
    let mut d = fixture();
    // Pure viral weapon at high status keeps 10 stacks by itself.
    let c = &mut d.weapons[0].modes[0].components[0];
    c.damage = [(wf_data::DamageType::Viral, 160.0)].into_iter().collect();
    c.status_chance = 5.0;
    let build = Build { weapon: "Laetum".into(), ..Default::default() };
    let t = |v: Option<f64>| Target { enemy: Some("sp-grineer".into()), armor_strip: 1.0, viral_stacks: v, ..Default::default() };
    let own = compute(&d, &build, &t(None)).unwrap().modes[0].viral_stacks;
    let low = compute(&d, &build, &t(Some(2.0))).unwrap().modes[0].viral_stacks;
    assert!(close(own, 10.0));
    assert!(close(low, own));
}

#[test]
fn outsourced_viral_applies_to_non_viral_weapon() {
    let t = Target { enemy: Some("sp-grineer".into()), armor_strip: 1.0, viral_stacks: Some(10.0), ..Default::default() };
    let m = &run(&[], t).modes[0];
    assert!(close(m.viral_stacks, 10.0));
    assert!(close(m.per_shot, m.per_shot_raw * 4.25));
}

#[test]
fn ability_damage_is_a_separate_multiplier() {
    let roar = wf_data::Modifier {
        source: "Roar".into(),
        stat: wf_data::Stat::AbilityDamage,
        value: 0.5,
        max_stacks: 1,
        applies_to: wf_data::ComponentFilter::All,
        condition: wf_data::Condition::Always,
        per: None,
    };
    let base = Build { weapon: "Laetum".into(), mods: vec!["Hornet Strike".into()], ..Default::default() };
    let buffed = Build { buffs: vec![roar], ..base.clone() };
    let a = compute(&fixture(), &base, &Target::default()).unwrap().modes[0].per_shot;
    let b = compute(&fixture(), &buffed, &Target::default()).unwrap().modes[0].per_shot;
    assert!(close(b, a * 1.5));
}

#[test]
fn fire_rate_lock_ignores_fire_rate_bonuses() {
    let mut d = fixture();
    let mut lock = d.mods[0].clone();
    lock.id = "cannon".into();
    lock.name = "Semi-Pistol Cannonade".into();
    lock.modifiers[0].value = 3.0;
    lock.locks_fire_rate = true;
    lock.requires_trigger = Some(wf_data::Trigger::Semi);
    let mut speed = d.mods[0].clone();
    speed.id = "gs".into();
    speed.name = "Gunslinger".into();
    speed.modifiers[0].stat = wf_data::Stat::FireRate;
    speed.modifiers[0].value = 0.72;
    d.mods.push(lock);
    d.mods.push(speed);
    let b = Build { weapon: "Laetum".into(), mods: vec!["Semi-Pistol Cannonade".into(), "Gunslinger".into()], ..Default::default() };
    let r = compute(&d, &b, &Target::default()).unwrap();
    assert!(close(r.modes[0].fire_rate, 2.5));
    // Incarnon mode is "auto" in the fixture but the weapon's primary trigger is semi, so the mod fits.
    assert!(d.find_mod("Semi-Pistol Cannonade").unwrap().fits(&d.weapons[0]));
}

#[test]
fn headshot_effects_toggle() {
    let mut d = fixture();
    d.mods[0].modifiers[0].condition = wf_data::Condition::OnHeadshotKill;
    let mut b = Build { weapon: "Laetum".into(), mods: vec!["Hornet Strike".into()], ..Default::default() };
    let on = compute(&d, &b, &Target::default()).unwrap().modes[0].per_shot;
    b.conditions.headshot_effects = false;
    let off = compute(&d, &b, &Target::default()).unwrap().modes[0].per_shot;
    assert!(close(off, 160.0 * 1.264));
    assert!(on > off);
}
