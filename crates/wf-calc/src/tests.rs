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
    // Bleed: 2.5 shots/s x 22% x 62.5% Slash share (96 quantizes to 100 of 160), 6 ticks of 35% x 160 x crit 1.264.
    // Averaged over the default 15 s fight, stacks ramp up over the first 6 s: x(1 - 6/30).
    let bleed = 2.5 * 0.22 * 0.625 * 6.0 * 0.35 * 160.0 * (1.0 + 0.22 * 1.2) * (1.0 - 6.0 / 30.0);
    assert!(close(m.status_dps, bleed), "status {} vs {bleed}", m.status_dps);
    assert!(close(m.burst_dps, m.per_shot * 2.5 + bleed));
    // 12 rounds over 12/2.5 s + 2 s reload; status keeps the same uptime.
    let hits = m.per_shot * 12.0 / (12.0 / 2.5 + 2.0);
    assert!(close(m.sustained_dps, hits + bleed * hits / (m.per_shot * 2.5)));
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
        threshold: None,
        aiming: false,
        only_slots: vec![],
        not_slots: vec![],
        trigger: None,
        mode_contains: None,
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

fn melee_fixture() -> GameData {
    let mut d = fixture();
    let mut w = d.weapons[0].clone();
    w.id = "/Test/Sword".into();
    w.name = "Test Sword".into();
    w.slot = wf_data::Slot::Melee;
    w.class = wf_data::WeaponClass::Melee;
    w.mod_pool = wf_data::ModPool::Melee;
    w.melee = Some(wf_data::MeleeProfile {
        class: "Sword".into(),
        attack_speed: 1.0,
        range_m: 2.0,
        follow_through: 0.6,
        combo_duration_s: 5.0,
        heavy_damage: 300.0,
        wind_up_s: 0.5,
        stances: vec!["Test Stance".into()],
    });
    let mut light = w.modes[0].clone();
    light.name = "Test Stance: Combo (Neutral)".into();
    light.melee_role = Some(wf_data::MeleeRole::Light);
    light.magazine = None;
    light.fire_rate = 0.5;
    let mut heavy = light.clone();
    heavy.name = "Heavy Attack".into();
    heavy.melee_role = Some(wf_data::MeleeRole::Heavy);
    heavy.headline = false;
    heavy.fire_rate = 2.0;
    heavy.components[0].rules.combo_scaling = true;
    heavy.components[0].rules.heavy = true;
    let mut tenno = heavy.clone();
    tenno.name = "Tennokai".into();
    tenno.melee_role = Some(wf_data::MeleeRole::Tennokai);
    tenno.components[0].rules.tennokai = true;
    w.modes = vec![light, heavy, tenno];
    d.weapons = vec![w];
    let melee_mod = |id: &str, name: &str, stat: wf_data::Stat, value: f64, applies: wf_data::ComponentFilter| {
        let mut m = d.mods[0].clone();
        m.id = id.into();
        m.name = name.into();
        m.pool = wf_data::ModPool::Melee;
        m.exclusive_group = None;
        m.modifiers[0].stat = stat;
        m.modifiers[0].value = value;
        m.modifiers[0].applies_to = applies;
        m
    };
    use wf_data::{ComponentFilter as F, Stat as S};
    d.mods = vec![
        melee_mod("pr", "Primed Reach", S::Range, 3.0, F::All),
        melee_mod("kb", "Killing Blow", S::BaseDamage, 1.2, F::HeavyOnly),
        melee_mod("me", "Master's Edge", S::BaseDamage, 0.6, F::TennokaiOnly),
        melee_mod("br", "Blood Rush", S::CritChance, 0.4, F::All),
    ];
    d.mods[3].modifiers[0].per = Some(wf_data::PerCount::ComboMultiplier);
    d
}

fn melee_run(mods: &[&str], cond: Conditions) -> BuildResult {
    let b = Build { weapon: "Test Sword".into(), mods: mods.iter().map(|s| s.to_string()).collect(), conditions: cond, ..Default::default() };
    compute(&melee_fixture(), &b, &Target::default()).unwrap()
}

#[test]
fn melee_range_is_flat_and_reported() {
    let r = melee_run(&["Primed Reach"], Conditions::default());
    assert!(close(r.modes[0].range_m.unwrap(), 5.0));
    assert!(close(r.modes[0].attack_speed.unwrap(), 1.0));
}

#[test]
fn heavy_uses_heavy_combo_and_tennokai_uses_light_combo() {
    let c = Conditions { combo_multiplier: 12.0, heavy_combo_multiplier: 5.0, ..Default::default() };
    let r = melee_run(&[], c);
    let light = r.modes[0].components[0].per_projectile_raw;
    let heavy = r.modes[1].components[0].per_projectile_raw;
    let tenno = r.modes[2].components[0].per_projectile_raw;
    // Light hits ignore combo; heavy x5; Tennokai x12.
    assert!(close(heavy, light * 5.0));
    assert!(close(tenno, light * 12.0));
    assert_eq!(r.modes[1].combo_multiplier, Some(5.0));
    assert_eq!(r.modes[2].combo_multiplier, Some(12.0));
}

#[test]
fn heavy_and_tennokai_only_bonuses() {
    let base = melee_run(&[], Conditions::default());
    let r = melee_run(&["Killing Blow", "Master's Edge"], Conditions::default());
    assert!(close(r.modes[0].per_shot, base.modes[0].per_shot), "light unaffected");
    assert!(close(r.modes[1].per_shot, base.modes[1].per_shot * 2.2), "heavy +120%");
    assert!(close(r.modes[2].per_shot, base.modes[2].per_shot * 2.8), "tennokai +120% heavy +60% tennokai");
}

#[test]
fn combo_mods_scale_with_the_hit_combo() {
    let at1 = melee_run(&["Blood Rush"], Conditions { combo_multiplier: 1.0, heavy_combo_multiplier: 5.0, ..Default::default() });
    let at12 = melee_run(&["Blood Rush"], Conditions { combo_multiplier: 12.0, heavy_combo_multiplier: 5.0, ..Default::default() });
    assert!(close(at1.modes[0].components[0].crit_chance, 0.22));
    assert!(close(at12.modes[0].components[0].crit_chance, 0.22 * (1.0 + 0.4 * 11.0)));
    // The heavy hit sees its own (5x) combo for Blood Rush.
    assert!(close(at12.modes[1].components[0].crit_chance, 0.22 * (1.0 + 0.4 * 4.0)));
}

fn evo_fixture() -> GameData {
    let mut d = fixture();
    d.weapons[0].modes[1].incarnon_form = true;
    d.weapons[0].evolutions = serde_json::from_value(json!([
        {"tier": 4, "options": [
            {"name": "Elemental Excess", "text": "", "modifiers": [
                {"source": "EE", "stat": {"kind": "statusChanceFlat"}, "value": 0.2},
                {"source": "EE", "stat": {"kind": "critChanceFlat"}, "value": -0.1}]},
            {"name": "Incarnon Only Damage", "text": "", "forms": "incarnon", "modifiers": [
                {"source": "IOD", "stat": {"kind": "baseDamage"}, "value": 1.0}]}
        ]},
        {"tier": 5, "options": [
            {"name": "Devouring Attrition", "text": "", "behaviour": {"kind": "devouringAttrition", "chance": 0.5, "bonus": 20.0}},
            {"name": "Overwhelming Attrition", "text": "", "behaviour": {"kind": "overwhelmingAttrition", "bonus": 4.0, "maxStacks": 3, "durationS": 10.0}}
        ]}
    ]))
    .unwrap();
    d.enemies.push(serde_json::from_value(json!({"id": "boss", "name": "Boss", "faction": "none", "armor": 0.0, "isBoss": true})).unwrap());
    d
}

fn evo_run(d: &GameData, evos: &[&str], target: Target) -> BuildResult {
    let b = Build { weapon: "Laetum".into(), evolutions: evos.iter().map(|s| s.to_string()).collect(), ..Default::default() };
    compute(d, &b, &target).unwrap()
}

#[test]
fn elemental_excess_is_flat() {
    let r = evo_run(&evo_fixture(), &["Elemental Excess"], Target::default());
    let c = &r.modes[0].components[0];
    assert!(close(c.crit_chance, 0.22 - 0.1));
    assert!(close(c.status_chance, 0.22 + 0.2));
}

#[test]
fn evolution_forms_are_respected() {
    let d = evo_fixture();
    let base = evo_run(&d, &[], Target::default());
    let r = evo_run(&d, &["Incarnon Only Damage"], Target::default());
    assert!(close(r.modes[0].per_shot, base.modes[0].per_shot), "normal form unaffected");
    assert!(close(r.modes[1].per_shot, base.modes[1].per_shot * 2.0), "incarnon form doubled");
}

#[test]
fn devouring_attrition_expected_value_and_bosses() {
    let d = evo_fixture();
    let base = evo_run(&d, &[], Target::default()).modes[0].per_shot;
    let da = evo_run(&d, &["Devouring Attrition"], Target::default()).modes[0].per_shot;
    // Non-crit share 78% gets x11 on average; crit part unchanged.
    let expected = 160.0 * (0.78 * 11.0 + 0.22 * 2.2);
    assert!(close(da, expected), "{da} vs {expected}");
    let boss = evo_run(&d, &["Devouring Attrition"], Target { enemy: Some("boss".into()), ..Default::default() });
    assert!(close(boss.modes[0].per_shot, base));
    assert!(boss.modes[0].approximations.iter().any(|a| a.contains("bosses")));
}

#[test]
fn overwhelming_attrition_adds_stacked_base_damage() {
    let d = evo_fixture();
    let base = evo_run(&d, &[], Target::default()).modes[0].per_shot;
    let oa = evo_run(&d, &["Overwhelming Attrition"], Target::default()).modes[0].per_shot;
    // 22% crit, 22% status, 2.5 hits/s: stacks stay near 3 -> base damage x ~13.
    assert!(oa > base * 12.0 && oa < base * 13.01, "{} x", oa / base);
}

#[test]
fn unknown_evolution_is_an_error() {
    let b = Build { weapon: "Laetum".into(), evolutions: vec!["Nope".into()], ..Default::default() };
    assert_eq!(compute(&evo_fixture(), &b, &Target::default()).unwrap_err().code, ErrorCode::UnknownEvolution);
}

#[test]
fn roar_is_faction_type_and_adds_to_bane() {
    let m = |stat, value| wf_data::Modifier {
        source: "x".into(),
        stat,
        value,
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
    };
    let t = Target { enemy: Some("sp-grineer".into()), armor_strip: 1.0, ..Default::default() };
    let base = compute(&fixture(), &Build { weapon: "Laetum".into(), ..Default::default() }, &t).unwrap().modes[0].per_shot;
    let roar = Build { weapon: "Laetum".into(), buffs: vec![m(wf_data::Stat::FactionDamageAll, 0.5)], ..Default::default() };
    let both = Build { buffs: vec![m(wf_data::Stat::FactionDamageAll, 0.5), m(wf_data::Stat::FactionDamage(wf_data::Faction::Grineer), 0.55)], ..roar.clone() };
    assert!(close(compute(&fixture(), &roar, &t).unwrap().modes[0].per_shot, base * 1.5));
    // Additive with Bane: 1 + 0.5 + 0.55, not 1.5 x 1.55.
    assert!(close(compute(&fixture(), &both, &t).unwrap().modes[0].per_shot, base * 2.05));
}

fn with_mod(stat: wf_data::Stat, value: f64, condition: wf_data::Condition, threshold: Option<f64>) -> Build {
    Build {
        weapon: "Laetum".into(),
        buffs: vec![wf_data::Modifier {
            source: "evo".into(),
            stat,
            value,
            max_stacks: 1,
            applies_to: wf_data::ComponentFilter::All,
            condition,
            per: None,
            threshold,
            aiming: false,
            only_slots: vec![],
            not_slots: vec![],
            trigger: None,
            mode_contains: None,
        }],
        ..Default::default()
    }
}

#[test]
fn base_stat_additions_scale_with_mods() {
    use wf_data::{Condition::Always, Stat};
    let d = fixture();
    let shot = |b: &Build| compute(&d, b, &Target::default()).unwrap().modes[0].components[0].clone();
    // +40 flat base damage on a 160 attack: x1.25 before mods.
    let base = shot(&Build { weapon: "Laetum".into(), ..Default::default() }).per_projectile_raw;
    assert!(close(shot(&with_mod(Stat::BaseDamageFlat, 40.0, Always, None)).per_projectile_raw, base * 1.25));
    // Base crit chance is added before the (here zero) mod multiplier.
    assert!(close(shot(&with_mod(Stat::CritChanceBase, 0.18, Always, None)).crit_chance, 0.40));
    assert!(close(shot(&with_mod(Stat::CritMultBase, 0.6, Always, None)).crit_mult, 2.8));
    assert!(close(shot(&with_mod(Stat::StatusChanceBase, 0.34, Always, None)).status_chance, 0.56));
}

#[test]
fn prelude_of_might_checks_final_crit_chance() {
    use wf_data::{Condition::CritChanceBelow, Stat};
    let d = fixture();
    let cd = |thr: f64| {
        compute(&d, &with_mod(Stat::CritMultBase, 3.0, CritChanceBelow, Some(thr)), &Target::default()).unwrap().modes[0].components[0].crit_mult
    };
    assert!(close(cd(0.5), 5.2), "22% < 50%: active");
    assert!(close(cd(0.2), 2.2), "22% >= 20%: inactive");
}

#[test]
fn status_types_below_condition() {
    use wf_data::{Condition::StatusTypesBelow, Stat};
    let d = fixture();
    let mut b = with_mod(Stat::CritDamage, 1.0, StatusTypesBelow, Some(3.0));
    b.conditions.status_types_auto = false;
    b.conditions.status_types = 2.0;
    assert!(close(compute(&d, &b, &Target::default()).unwrap().modes[0].components[0].crit_mult, 4.4));
    b.conditions.status_types = 4.0;
    assert!(close(compute(&d, &b, &Target::default()).unwrap().modes[0].components[0].crit_mult, 2.2));
}

#[test]
fn multishot_damage_only_boosts_extra_projectiles() {
    use wf_data::{Condition::Always, Stat};
    let d = fixture();
    let mut b = with_mod(Stat::MultishotDamage, 0.6, Always, None);
    let one = compute(&d, &b, &Target::default()).unwrap().modes[0].per_shot;
    assert!(close(one, 160.0 * 1.264), "no extra projectiles, no bonus");
    b.buffs.push(wf_data::Modifier { stat: Stat::Multishot, value: 1.0, source: "ms".into(), ..b.buffs[0].clone() });
    let two = compute(&d, &b, &Target::default()).unwrap().modes[0].per_shot;
    // 2 projectiles, the extra one at +60%: 2.6 x one projectile.
    assert!(close(two, 160.0 * 1.264 * 2.6));
}

#[test]
fn status_from_crit_link_is_capped() {
    use wf_data::{Condition::Always, Stat};
    let d = fixture();
    let sc = |ratio: f64, cap: f64| {
        compute(&d, &with_mod(Stat::StatusChanceBaseFromCrit, ratio, Always, Some(cap)), &Target::default()).unwrap().modes[0].components[0].status_chance
    };
    assert!(close(sc(0.5, 1.0), 0.22 + 0.11));
    assert!(close(sc(0.5, 0.05), 0.22 + 0.05));
}

#[test]
fn raw_is_an_upper_bound_for_armored_targets() {
    let mut d = fixture();
    // A Viral/Corrosive weapon that strips armor and stacks Viral on its own.
    let c = &mut d.weapons[0].modes[0].components[0];
    c.damage = [(wf_data::DamageType::Viral, 80.0), (wf_data::DamageType::Corrosive, 80.0)].into_iter().collect();
    c.status_chance = 3.0;
    let b = Build { weapon: "Laetum".into(), ..Default::default() };
    let raw = compute(&d, &b, &Target::default()).unwrap().modes[0].clone();
    let sp = compute(&d, &b, &Target { enemy: Some("sp-grineer".into()), ..Default::default() }).unwrap().modes[0].clone();
    assert!(raw.viral_stacks > 9.9, "self-applied viral counts on the raw target too");
    assert!(sp.burst_dps <= raw.burst_dps, "armor can only reduce damage: {} vs {}", sp.burst_dps, raw.burst_dps);
}

#[test]
fn gunco_adds_or_multiplies_per_attack() {
    use wf_data::{Condition::Always, Stat};
    let galv = |d: &GameData| {
        let mut b = with_mod(Stat::BaseDamage, 0.4, Always, None);
        b.buffs[0].per = Some(wf_data::PerCount::StatusType);
        b.buffs.push(wf_data::Modifier { stat: Stat::BaseDamage, value: 1.0, per: None, source: "serration".into(), ..b.buffs[0].clone() });
        b.conditions.status_types_auto = false;
        b.conditions.status_types = 2.0;
        compute(d, &b, &Target::default()).unwrap().modes[0].per_shot
    };
    let base = 160.0 * 1.264;
    // Default (not in sheet): adds -> 1 + 1.0 + 0.8.
    assert!(close(galv(&fixture()), base * 2.8));
    // Multiplies: (1 + 1.0) x (1 + 0.8).
    let mut d = fixture();
    d.weapons[0].modes[0].components[0].rules.gun_co = Some(wf_data::GunCo { factor: 1.0, mode: wf_data::GunCoMode::Multiplies });
    assert!(close(galv(&d), base * 2.0 * 1.8));
    // Factor scales the bonus: adds 0.5 x 0.8.
    d.weapons[0].modes[0].components[0].rules.gun_co = Some(wf_data::GunCo { factor: 0.5, mode: wf_data::GunCoMode::Adds });
    assert!(close(galv(&d), base * 2.4));
}

#[test]
fn companion_weapons_ignore_aiming_and_headshot_effects() {
    use wf_data::{Condition, Stat};
    let mut d = fixture();
    d.weapons[0].slot = wf_data::Slot::Companion;
    let mut aim = with_mod(Stat::BaseDamage, 1.0, Condition::Always, None);
    aim.buffs[0].aiming = true;
    let base = compute(&d, &Build { weapon: "Laetum".into(), ..Default::default() }, &Target::default()).unwrap().modes[0].per_shot;
    assert!(close(compute(&d, &aim, &Target::default()).unwrap().modes[0].per_shot, base), "aim-only bonus ignored");
    let hs = with_mod(Stat::BaseDamage, 1.0, Condition::OnHeadshotKill, None);
    assert!(close(compute(&d, &hs, &Target::default()).unwrap().modes[0].per_shot, base), "headshot-kill bonus ignored");
    // The same aim bonus does count on a player weapon.
    assert!(compute(&fixture(), &aim, &Target::default()).unwrap().modes[0].per_shot > base * 1.9);
}

#[test]
fn slot_scoped_buffs() {
    use wf_data::{Condition::Always, Slot, Stat};
    let d = fixture();
    let base = compute(&d, &Build { weapon: "Laetum".into(), ..Default::default() }, &Target::default()).unwrap().modes[0].per_shot;
    let mut only_companion = with_mod(Stat::BaseDamage, 1.0, Always, None);
    only_companion.buffs[0].only_slots = vec![Slot::Companion];
    assert!(close(compute(&d, &only_companion, &Target::default()).unwrap().modes[0].per_shot, base));
    let mut not_secondary = with_mod(Stat::BaseDamage, 1.0, Always, None);
    not_secondary.buffs[0].not_slots = vec![Slot::Secondary];
    assert!(close(compute(&d, &not_secondary, &Target::default()).unwrap().modes[0].per_shot, base));
}

fn arcane(v: serde_json::Value) -> wf_data::Arcane {
    serde_json::from_value(v).unwrap()
}

fn arcane_run(d: &mut GameData, a: serde_json::Value, weapon: &str, mods: &[&str], cond: Conditions) -> (BuildResult, BuildResult) {
    let a = arcane(a);
    let name = a.name.clone();
    d.arcanes.push(a);
    let b = Build { weapon: weapon.into(), mods: mods.iter().map(|s| s.to_string()).collect(), conditions: cond, ..Default::default() };
    let without = compute(d, &b, &Target::default()).unwrap();
    let with = compute(d, &Build { arcane: Some(name), ..b }, &Target::default()).unwrap();
    (without, with)
}

#[test]
fn melee_duplicate_repeats_yellow_crits() {
    let mut d = melee_fixture();
    let a = json!({"id": "dup", "name": "Melee Duplicate", "slot": "melee", "behaviour": "meleeDuplicate", "description": ""});
    // 22% crit chance: 22% of hits are yellow crits.
    let (base, dup) = arcane_run(&mut d, a.clone(), "Test Sword", &[], Conditions::default());
    assert!(close(dup.modes[0].per_shot, base.modes[0].per_shot * 1.22));
    // Blood Rush at 12x: 118.8% crit chance, so 81.2% of hits are yellow.
    let (base, dup) = arcane_run(&mut melee_fixture(), a, "Test Sword", &["Blood Rush"], Conditions::default());
    assert!(close(dup.modes[0].per_shot, base.modes[0].per_shot * (1.0 + (2.0 - 0.22 * 5.4))));
}

#[test]
fn melee_crescendo_sets_a_combo_floor() {
    let a = json!({"id": "cre", "name": "Melee Crescendo", "slot": "melee", "behaviour": null, "comboFloor": 12.0, "description": ""});
    let c = Conditions { combo_multiplier: 1.0, heavy_combo_multiplier: 5.0, ..Default::default() };
    let (base, cre) = arcane_run(&mut melee_fixture(), a, "Test Sword", &[], c);
    assert!(close(cre.modes[1].per_shot, base.modes[1].per_shot * 12.0 / 5.0), "heavy combo 5x -> 12x");
    assert_eq!(cre.modes[2].combo_multiplier, Some(12.0));
}

#[test]
fn melee_retaliation_scales_with_shields() {
    let a = json!({"id": "ret", "name": "Melee Retaliation", "slot": "melee", "behaviour": null, "description": "",
        "modifiers": [{"source": "Melee Retaliation", "stat": {"kind": "baseDamage"}, "value": 0.3, "per": "shields200", "maxStacks": 14}]});
    let (base, ret) = arcane_run(&mut melee_fixture(), a.clone(), "Test Sword", &[], Conditions { shields: 1000.0, ..Default::default() });
    assert!(close(ret.modes[0].per_shot, base.modes[0].per_shot * 2.5));
    let (base, ret) = arcane_run(&mut melee_fixture(), a, "Test Sword", &[], Conditions { shields: 9000.0, ..Default::default() });
    assert!(close(ret.modes[0].per_shot, base.modes[0].per_shot * 5.2), "capped at +420%");
}

#[test]
fn status_stack_arcane_fills_with_frequent_procs() {
    // Heat procs about 0.26/s against a shared 10 s timer: Cascadia Flare reaches all 40 stacks.
    let a = json!({"id": "fl", "name": "Cascadia Flare", "slot": "secondary", "behaviour": null, "description": "",
        "stacking": {"status": "heat", "maxStacks": 40.0, "durationS": 10.0},
        "modifiers": [{"source": "Cascadia Flare", "stat": {"kind": "baseDamage"}, "value": 0.12}]});
    let (base, fl) = arcane_run(&mut fixture(), a, "Laetum", &["Heated Charge"], Conditions::default());
    assert!(close(fl.modes[0].per_shot_raw, base.modes[0].per_shot_raw * 5.8));
    assert!(fl.modes[0].approximations.iter().any(|s| s.contains("40.0 of 40")));
}

#[test]
fn shiver_uses_cold_stacks_on_the_target() {
    let a = json!({"id": "sh", "name": "Secondary Shiver", "slot": "secondary", "behaviour": null, "description": "",
        "stacking": {"status": "cold", "maxStacks": 10.0},
        "modifiers": [{"source": "Secondary Shiver", "stat": {"kind": "baseDamage"}, "value": 0.45}]});
    let (base, sh) = arcane_run(&mut fixture(), a, "Laetum", &["Deep Freeze"], Conditions::default());
    let stacks = (base.modes[0].procs_per_s[&wf_data::DamageType::Cold] * 6.0).min(10.0);
    assert!(stacks > 0.5 && stacks < 10.0);
    assert!(close(sh.modes[0].per_shot_raw, base.modes[0].per_shot_raw * (1.0 + 0.45 * stacks)));
}

#[test]
fn longbow_sharpshot_follows_the_headshot_share() {
    let a = json!({"id": "ls", "name": "Longbow Sharpshot", "slot": "primary", "behaviour": null, "description": "", "classes": ["bow"],
        "modifiers": [{"source": "Longbow Sharpshot", "stat": {"kind": "finalDamage"}, "value": 3.0, "condition": "headshotShare"}]});
    let (base, ls) = arcane_run(&mut fixture(), a.clone(), "Laetum", &[], Conditions::default());
    assert!(close(ls.modes[0].per_shot, base.modes[0].per_shot), "no weak point hits, no bonus");
    let hs = Conditions { headshot_share: 1.0, ..Default::default() };
    let (base, ls) = arcane_run(&mut fixture(), a, "Laetum", &[], hs);
    assert!(close(ls.modes[0].per_shot, base.modes[0].per_shot * 4.0));
}

fn with_evolution(d: &mut GameData, evo: serde_json::Value) {
    d.weapons[0].modes[1].incarnon_form = true;
    d.weapons[0].evolutions = serde_json::from_value(json!([{"tier": 4, "options": [evo]}])).unwrap();
}

#[test]
fn armor_strip_per_status_stack() {
    // Slash keeps ~2 stacks up; at 100% per stack the armor is gone, so damage equals raw.
    let mut d = fixture();
    with_evolution(&mut d, json!({"name": "Strip", "text": "", "behaviour": {"kind": "armorStripPerStatus", "status": "slash", "perStack": 1.0}}));
    let t = Target { enemy: Some("sp-grineer".into()), ..Default::default() };
    let base = evo_run(&d, &[], t.clone());
    let r = evo_run(&d, &["Strip"], t);
    assert!(base.modes[0].per_shot < base.modes[0].per_shot_raw);
    assert!(close(r.modes[0].per_shot, r.modes[0].per_shot_raw));
}

#[test]
fn headshot_only_crits() {
    let mut d = fixture();
    with_evolution(&mut d, json!({"name": "KG", "text": "", "behaviour": {"kind": "headshotOnlyCrits", "headCritChance": 1.5}}));
    let b = |hs: f64| Build {
        weapon: "Laetum".into(),
        evolutions: vec!["KG".into()],
        conditions: Conditions { headshot_share: hs, ..Default::default() },
        ..Default::default()
    };
    let body = compute(&d, &b(0.0), &Target::default()).unwrap();
    assert!(close(body.modes[0].per_shot, 160.0), "no crits on bodyshots");
    let head = compute(&d, &b(1.0), &Target::default()).unwrap();
    // Weak points: 22% + 22% x 1.5 = 55% crit chance at 2.2x, then x2 headshot.
    let cc = 0.22 + 0.22 * 1.5;
    assert!(close(head.modes[0].per_shot, 160.0 * 2.0 * ((1.0 - cc) + 2.0 * cc * 2.2)));
}

#[test]
fn situational_triggers_are_off_unless_enabled() {
    let mut d = fixture();
    with_evolution(&mut d, json!({"name": "OS", "text": "", "modifiers": [
        {"source": "OS", "stat": {"kind": "baseDamage"}, "value": 1.0, "trigger": "with overshields"}]}));
    let base = evo_run(&d, &[], Target::default());
    let off = evo_run(&d, &["OS"], Target::default());
    assert!(close(off.modes[0].per_shot, base.modes[0].per_shot));
    let b = Build {
        weapon: "Laetum".into(),
        evolutions: vec!["OS".into()],
        conditions: Conditions { triggers: vec!["with overshields".into()], ..Default::default() },
        ..Default::default()
    };
    let on = compute(&d, &b, &Target::default()).unwrap();
    assert!(close(on.modes[0].per_shot, base.modes[0].per_shot * 2.0));
}

#[test]
fn mode_scoped_modifier() {
    let mut d = fixture();
    with_evolution(&mut d, json!({"name": "Charge", "text": "", "modifiers": [
        {"source": "C", "stat": {"kind": "baseDamage"}, "value": 1.0, "modeContains": "Incarnon"}]}));
    let base = evo_run(&d, &[], Target::default());
    let r = evo_run(&d, &["Charge"], Target::default());
    assert!(close(r.modes[0].per_shot, base.modes[0].per_shot));
    assert!(close(r.modes[1].per_shot, base.modes[1].per_shot * 2.0));
}

#[test]
fn incarnon_sustained_includes_gauge_recharge() {
    let mut d = fixture();
    d.weapons[0].modes[1].incarnon_form = true;
    d.weapons[0].modes[1].ammo_pool = serde_json::from_value(json!({"kind": "incarnon", "rounds": 40, "recharge_s": null, "charge_gain": 4.0})).unwrap();
    let r = compute(&d, &Build { weapon: "Laetum".into(), ..Default::default() }, &Target::default()).unwrap();
    let (normal, inc) = (&r.modes[0], &r.modes[1]);
    // 10 weak point hits refill 40 rounds; half the normal form's hits land on weak points.
    let hits_per_s = normal.fire_rate * normal.sustained_dps / normal.burst_dps * 0.5;
    let t = 10.0 / hits_per_s;
    let hits = (inc.per_shot * 40.0 + normal.sustained_dps * t) / (40.0 / inc.fire_rate + t);
    let expected = hits + inc.status_dps * hits / (inc.per_shot * inc.fire_rate);
    assert!(close(inc.sustained_dps, expected));
    assert!(inc.sustained_dps < inc.burst_dps);
}

fn status_weapon(damage: serde_json::Value, status: f64) -> GameData {
    let mut d = fixture();
    d.weapons[0].modes[0].components[0].damage = serde_json::from_value(damage).unwrap();
    d.weapons[0].modes[0].components[0].status_chance = status;
    d.weapons[0].modes[0].components[0].crit_chance = 0.0;
    d
}

fn status_run(d: &GameData, cond: Conditions, enemy: Option<&str>) -> ModeResult {
    let b = Build { weapon: "Laetum".into(), conditions: cond, ..Default::default() };
    compute(d, &b, &Target { enemy: enemy.map(String::from), ..Default::default() }).unwrap().modes.remove(0)
}

#[test]
fn heat_stacks_grow_over_the_fight() {
    // Pure Heat, 100% status: 2.5 procs/s, ticks of 50% x 100.
    let d = status_weapon(json!({"heat": 100.0}), 1.0);
    let steady = status_run(&d, Conditions { fight_s: 0.0, ..Default::default() }, None);
    assert!(close(steady.status_dps, 2.5 * 6.0 * 50.0), "steady state: {}", steady.status_dps);
    let long = status_run(&d, Conditions { fight_s: 30.0, ..Default::default() }, None);
    assert!(close(long.status_dps, 2.5 * 15.0 * 50.0), "refreshed stacks average over the fight: {}", long.status_dps);
    // Status duration changes nothing for refreshed Heat.
    let mut d2 = d.clone();
    d2.weapons[0].modes[0].components[0].status_chance = 1.0;
    let b = Build {
        weapon: "Laetum".into(),
        buffs: vec![serde_json::from_value(json!({"source": "Duration", "stat": {"kind": "statusDuration"}, "value": 1.0})).unwrap()],
        conditions: Conditions { fight_s: 30.0, ..Default::default() },
        ..Default::default()
    };
    let with_duration = compute(&d2, &b, &Target::default()).unwrap().modes.remove(0);
    assert!(close(with_duration.status_dps, long.status_dps));
}

#[test]
fn gas_caps_at_ten_clouds() {
    let d = status_weapon(json!({"gas": 100.0}), 1.0);
    let m = status_run(&d, Conditions { fight_s: 0.0, ..Default::default() }, None);
    // 2.5 procs/s x 6 s = 15 clouds, capped at 10.
    assert!(close(m.status_dps, 10.0 * 50.0));
}

#[test]
fn blast_detonates_for_the_group_at_ten_stacks() {
    let d = status_weapon(json!({"blast": 100.0}), 5.0);
    let solo = status_run(&d, Conditions { group_size: 1.0, ..Default::default() }, None);
    // 12.5 procs/s x 30% x 100 on the target.
    assert!(close(solo.status_dps, 12.5 * 30.0));
    let group = status_run(&d, Conditions { group_size: 5.0, ..Default::default() }, None);
    // 12.5 procs/s reach 10 stacks within the 1.5 s fuse: 300% per stack to the 4 others (all within 5 m).
    assert!(close(group.group_dps - group.burst_dps, 4.0 * 12.5 * 300.0), "{}", group.group_dps - group.burst_dps);
}

#[test]
fn elemental_mods_scale_their_own_ticks() {
    let mut d = status_weapon(json!({"toxin": 100.0}), 1.0);
    d.mods.push(serde_json::from_value(json!({"id": "tx", "name": "Toxin Mod", "pool": "secondary", "compat": null, "polarity": "naramon",
        "baseDrain": 4, "maxRank": 5, "isExilus": false,
        "modifiers": [{"source": "Toxin Mod", "stat": {"kind": "element", "of": "toxin"}, "value": 1.0}]})).unwrap());
    let plain = status_run(&d, Conditions::default(), None);
    let b = Build { weapon: "Laetum".into(), mods: vec!["Toxin Mod".into()], ..Default::default() };
    let modded = compute(&d, &b, &Target::default()).unwrap().modes.remove(0);
    // Ticks: 50% of modded base (unchanged) x (1 + 100% Toxin mods).
    assert!(close(modded.status_dps, plain.status_dps * 2.0));
}

fn add_mod(d: &mut GameData, v: serde_json::Value) {
    d.mods.push(serde_json::from_value(v).unwrap());
}

#[test]
fn status_damage_scales_status_only() {
    let mut d = status_weapon(json!({"toxin": 100.0}), 1.0);
    add_mod(&mut d, json!({"id": "el", "name": "Elementalist", "pool": "secondary", "compat": null, "polarity": "naramon",
        "baseDrain": 4, "maxRank": 5, "isExilus": false,
        "modifiers": [{"source": "Elementalist", "stat": {"kind": "statusDamage"}, "value": 0.9}]}));
    let plain = status_run(&d, Conditions::default(), None);
    let b = Build { weapon: "Laetum".into(), mods: vec!["Elementalist".into()], ..Default::default() };
    let m = compute(&d, &b, &Target::default()).unwrap().modes.remove(0);
    assert!(close(m.status_dps, plain.status_dps * 1.9));
    assert!(close(m.per_shot, plain.per_shot));
}

#[test]
fn punch_through_reaches_two_more_enemies_at_most() {
    let mut d = status_weapon(json!({"impact": 100.0}), 0.0);
    d.weapons[0].modes[0].components[0].punch_through = 99999.0;
    let m = status_run(&d, Conditions::default(), None);
    assert!(close(m.group_dps, m.burst_dps * 3.0));
    d.weapons[0].modes[0].components[0].punch_through = 0.5;
    let m = status_run(&d, Conditions::default(), None);
    assert!(close(m.group_dps, m.burst_dps), "under a meter pierces nobody");
}

#[test]
fn distance_falloff_applies_at_the_engagement_distance() {
    let mut d = status_weapon(json!({"impact": 100.0}), 0.0);
    d.weapons[0].modes[0].components[0].falloff = Some(wf_data::Falloff { start_m: 10.0, end_m: 20.0, reduction: 0.6 });
    let near = status_run(&d, Conditions { engagement_m: 5.0, ..Default::default() }, None);
    let mid = status_run(&d, Conditions { engagement_m: 15.0, ..Default::default() }, None);
    assert!(close(mid.per_shot, near.per_shot * 0.7));
}

#[test]
fn puncture_stacks_raise_crit_chance_of_direct_hits() {
    // 2.5 procs/s of Puncture keep 5 stacks: +25% crit chance.
    let d = status_weapon(json!({"puncture": 100.0}), 1.0);
    let m = status_run(&d, Conditions::default(), None);
    assert!(close(m.components[0].crit_chance, 0.25), "{}", m.components[0].crit_chance);
}

#[test]
fn heavy_rotation_waits_for_initial_combo_regen() {
    let mut d = melee_fixture();
    // Galvanized Reflex-like: 50% heavy efficiency and 80 Initial Combo (5x).
    add_mod(&mut d, json!({"id": "gr", "name": "Reflex", "pool": "melee", "compat": null, "polarity": "naramon",
        "baseDrain": 4, "maxRank": 5, "isExilus": false,
        "modifiers": [{"source": "Reflex", "stat": {"kind": "heavyEfficiency"}, "value": 0.5},
                      {"source": "Reflex", "stat": {"kind": "initialCombo"}, "value": 80.0}]}));
    let b = Build { weapon: "Test Sword".into(), mods: vec!["Reflex".into()], conditions: Conditions { heavy_combo_multiplier: 1.0, ..Default::default() }, ..Default::default() };
    let r = compute(&d, &b, &Target::default()).unwrap();
    let heavy = &r.modes[1];
    assert_eq!(heavy.combo_multiplier, Some(5.0));
    // Wind-up 0.5 s, then 40 combo points come back at 40/s: one heavy every 1.5 s.
    assert!(close(heavy.fire_rate, 1.0 / 1.5), "{}", heavy.fire_rate);
}

#[test]
fn disciplines_merit_sets_tennokai_every_four_hits() {
    let mut d = melee_fixture();
    add_mod(&mut d, json!({"id": "dm", "name": "Discipline's Merit", "pool": "melee", "compat": null, "polarity": "naramon",
        "baseDrain": 4, "maxRank": 3, "isExilus": false, "tennokaiEvery": 4, "modifiers": []}));
    let run = |mods: Vec<String>| compute(&d, &Build { weapon: "Test Sword".into(), mods, ..Default::default() }, &Target::default()).unwrap();
    let random = run(vec![]);
    let merit = run(vec!["Discipline's Merit".into()]);
    // Light combo: 0.5 combos/s of 1 hit. Tennokai heavy wind-up 0.5 s plus 4 (or 1/0.15) light hits.
    assert!(close(merit.modes[2].fire_rate, 1.0 / (0.5 + 4.0 / 0.5)));
    assert!(close(random.modes[2].fire_rate, 1.0 / (0.5 + (1.0 / 0.15) / 0.5)));
}

#[test]
fn ammo_cost_sets_attacks_per_magazine_and_gauge() {
    let mut d = fixture();
    d.weapons[0].modes[0].ammo_cost = 4.0;
    let r = compute(&d, &Build { weapon: "Laetum".into(), ..Default::default() }, &Target::default()).unwrap();
    let m = &r.modes[0];
    // 12 rounds at 4 per attack: 3 attacks, then the 2 s reload.
    assert_eq!(m.magazine_shots, Some(3.0));
    let hits = m.per_shot * 3.0 / (3.0 / 2.5 + 2.0);
    assert!(close(m.sustained_dps - m.status_dps * hits / (m.per_shot * 2.5), hits));
    // Incarnon gauge of 40 rounds at 10 per attack: 4 attacks per charge.
    d.weapons[0].modes[1].ammo_cost = 10.0;
    let r = compute(&d, &Build { weapon: "Laetum".into(), ..Default::default() }, &Target::default()).unwrap();
    let inc = &r.modes[1];
    assert!(close(inc.per_charge.unwrap() - inc.status_dps * 4.0 / inc.fire_rate, inc.per_shot * 4.0));
}

#[test]
fn ammo_efficiency_is_capped_at_75_percent() {
    let d = fixture();
    let b = Build {
        weapon: "Laetum".into(),
        buffs: vec![serde_json::from_value(json!({"source": "AE", "stat": {"kind": "ammoEfficiency"}, "value": 1.0})).unwrap()],
        ..Default::default()
    };
    let m = compute(&d, &b, &Target::default()).unwrap().modes.remove(0);
    // 12 rounds at a quarter of a round per shot: 48 shots per magazine, still reloading.
    assert_eq!(m.magazine_shots, Some(48.0));
    assert!(m.sustained_dps < m.burst_dps);
}

#[test]
fn gas_clouds_linger_after_kills() {
    let d = status_weapon(json!({"gas": 100.0}), 1.0);
    let t = |h: Option<f64>| Target { health: h, ..Default::default() };
    let b = Build { weapon: "Laetum".into(), ..Default::default() };
    let no_deaths = compute(&d, &b, &t(None)).unwrap().modes.remove(0);
    let deaths = compute(&d, &b, &t(Some(1000.0))).unwrap().modes.remove(0);
    assert!(deaths.group_dps > no_deaths.group_dps * 1.01, "{} vs {}", deaths.group_dps, no_deaths.group_dps);
}

#[test]
fn charge_beam_adds_its_damage_and_rounds() {
    let mut d = fixture();
    // Mode 1 charges by firing mode 0 (2.5 ticks/s) for its 1/6.67 s cycle.
    d.weapons[0].modes[1].charge_beam = Some(0);
    let plain = compute(&fixture(), &Build { weapon: "Laetum".into(), ..Default::default() }, &Target::default()).unwrap();
    let r = compute(&d, &Build { weapon: "Laetum".into(), ..Default::default() }, &Target::default()).unwrap();
    let ticks = r.modes[0].fire_rate / r.modes[1].fire_rate;
    assert!(close(r.modes[1].per_shot, plain.modes[1].per_shot + r.modes[0].per_shot * ticks));
}

#[test]
fn weak_point_crit_chance_only_on_headshots() {
    let d = fixture();
    let run = |hs: f64| {
        let b = Build {
            weapon: "Laetum".into(),
            riven: vec![serde_json::from_value(json!({"source": "WPCC", "stat": {"kind": "headshotCritChance"}, "value": 1.0})).unwrap()],
            conditions: Conditions { headshot_share: hs, ..Default::default() },
            ..Default::default()
        };
        compute(&d, &b, &Target::default()).unwrap().modes.remove(0).per_shot
    };
    let plain = |hs: f64| {
        let b = Build { weapon: "Laetum".into(), conditions: Conditions { headshot_share: hs, ..Default::default() }, ..Default::default() };
        compute(&d, &b, &Target::default()).unwrap().modes.remove(0).per_shot
    };
    assert!(close(run(0.0), plain(0.0)));
    // Weak points: 22% + 22% x 100% = 44% crit chance at 2.2x, headshot x2.
    let cc = 0.44;
    assert!(close(run(1.0), 160.0 * 2.0 * ((1.0 - cc) + 2.0 * cc * 2.2)));
}

#[test]
fn infinite_ammo_on_headshots_removes_reloads() {
    let mut d = fixture();
    add_mod(&mut d, json!({"id": "ss", "name": "Skull Shots", "pool": "secondary", "compat": null, "polarity": "naramon",
        "baseDrain": 4, "maxRank": 3, "isExilus": false,
        "modifiers": [{"source": "Skull Shots", "stat": {"kind": "infiniteAmmoOnHeadshot"}, "value": 0.4, "threshold": 2.0}]}));
    let run = |hs: f64, effects: bool| {
        let b = Build {
            weapon: "Laetum".into(),
            mods: vec!["Skull Shots".into()],
            conditions: Conditions { headshot_share: hs, headshot_effects: effects, ..Default::default() },
            ..Default::default()
        };
        compute(&d, &b, &Target::default()).unwrap().modes.remove(0)
    };
    // Every shot a headshot: 2.5 x 40% = 1 trigger/s, buff up 1 - e^-2 = 86% of the time.
    let m = run(1.0, true);
    let up = 1.0 - (-2.0f64).exp();
    assert_eq!(m.magazine_shots, Some((12.0 / (1.0 - up)).floor()));
    // No headshot effects: no infinite ammo.
    assert_eq!(run(0.0, false).magazine_shots, Some(12.0));
}

/// Numbers-only mode (the optimizer's) gives exactly the numbers of the full calculation, for every
/// weapon in the game data, unmodded and with mods, raw and against an armored enemy.
#[test]
fn calc_only_matches_full_calculation() {
    let Ok(text) = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../data/gamedata.json")) else { return };
    let data: GameData = serde_json::from_str(&text).unwrap();
    let strip = |r: &BuildResult| -> Vec<serde_json::Value> {
        r.modes
            .iter()
            .map(|m| {
                let mut v = serde_json::to_value(m).unwrap();
                let o = v.as_object_mut().unwrap();
                o.remove("approximations");
                o.remove("explain");
                for c in o.get_mut("components").unwrap().as_array_mut().unwrap() {
                    c.as_object_mut().unwrap().remove("explain");
                }
                v
            })
            .collect()
    };
    let mut checked = 0;
    for w in &data.weapons {
        let mods: Vec<String> = data.mods.iter().filter(|m| m.fits(w) && m.exclusive_group.is_none()).take(8).map(|m| m.id.clone()).collect();
        for mods in [vec![], mods] {
            for enemy in [None, Some("sp-grineer".to_string())] {
                let target = Target { enemy, ..Default::default() };
                let mut build = Build { weapon: w.id.clone(), mods: mods.clone(), ..Default::default() };
                let Ok(full) = compute(&data, &build, &target) else { continue };
                build.conditions.calc_only = true;
                let quick = compute(&data, &build, &target).unwrap();
                assert_eq!(strip(&full), strip(&quick), "{} {:?}", w.name, mods);
                assert!(quick.modes.iter().all(|m| m.approximations.is_empty()), "{}: notes in numbers-only mode", w.name);
                checked += 1;
            }
        }
    }
    assert!(checked > 1000, "only {checked} builds checked");
}

/// Status types on the target are counted from what is on it: each outsourced status counts 1, the
/// weapon's own procs count by their uptime (Galvanized-style "per status type" bonuses follow).
#[test]
fn status_types_count_outsourced_and_own_procs() {
    use wf_data::{Condition::Always, Stat};
    let d = fixture();
    let mut b = with_mod(Stat::BaseDamage, 0.4, Always, None);
    b.buffs[0].per = Some(wf_data::PerCount::StatusType);
    let raw = |b: &Build, t: &Target| compute(&d, b, t).unwrap().modes[0].per_shot_raw;
    let mut manual = b.clone();
    manual.conditions.status_types_auto = false;
    manual.conditions.status_types = 0.0;
    let none = raw(&manual, &Target::default());
    // Raw damage = base x (1 + 0.4 x status types): read the count back.
    let types = |b: &Build, t: &Target| (raw(b, t) / none - 1.0) / 0.4;
    let own = types(&b, &Target::default());
    assert!(own > 0.0 && own <= 2.0 + 1e-9, "Impact and Slash by uptime: {own}");
    let viral = Target { viral_stacks: Some(10.0), ..Default::default() };
    assert!(close(types(&b, &viral), own + 1.0), "outsourced Viral adds one type");
    let both = Target { viral_stacks: Some(10.0), corrosive_stacks: Some(10.0), ..Default::default() };
    assert!(close(types(&b, &both), own + 2.0), "Viral and Corrosive outsourced");
}

/// On-hit stacks build up from zero: half the stacks reached on average until the cap, then most of it.
#[test]
fn on_hit_stacks_build_up() {
    use crate::engine::average_stacks;
    // 2 hits/s for 10 s, cap 50: never reaches it, average 10.
    assert!(close(average_stacks(2.0, 50.0, 10.0), 10.0));
    // 10 hits/s for 10 s, cap 50: full after 5 s, average 50 - 50^2 / 200 = 37.5.
    assert!(close(average_stacks(10.0, 50.0, 10.0), 37.5));
}

/// The arsenal crit values leave out conditional bonuses; the in-fight value includes them.
#[test]
fn arsenal_crit_leaves_out_conditional_bonuses() {
    use wf_data::{Condition, Stat};
    let d = fixture();
    let b = with_mod(Stat::CritChance, 1.0, Condition::OnHeadshot, None);
    let c = &compute(&d, &b, &Target::default()).unwrap().modes[0].components[0];
    assert!(close(c.arsenal_crit_chance, 0.22), "arsenal: base only, {}", c.arsenal_crit_chance);
    assert!(close(c.crit_chance, 0.44), "in the fight: +100% on headshot at full uptime, {}", c.crit_chance);
    assert!(close(c.arsenal_crit_mult, 2.2));
}

/// Tau procs on the target raise the weapon's status chance (+10% per stack, 8 s each, up to 10).
#[test]
fn tau_raises_status_chance_taken() {
    let mut d = fixture();
    let c = &mut d.weapons[0].modes[0].components[0];
    c.damage = [(wf_data::DamageType::Tau, 100.0)].into_iter().collect();
    c.status_chance = 0.5;
    let b = Build { weapon: "/Test/Laetum".into(), ..Default::default() };
    let m = &compute(&d, &b, &Target::default()).unwrap().modes[0];
    // 2.5 shots/s x 50% = 1.25 Tau procs/s x 8 s = 10 stacks (capped): status chance x 2.
    assert!(close(m.components[0].status_chance, 1.0), "{}", m.components[0].status_chance);
}
