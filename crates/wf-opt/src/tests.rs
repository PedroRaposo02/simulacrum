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
    assert_eq!(r.mods.len(), 8, "all normal slots used: {:?}", r.mods);
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
    d.mods.iter_mut().find(|m| m.name == "Hush").unwrap().modifiers[0].stat = Stat::CritDamage;
    let r = optimize(&d, "Test Pistol", &Build::default(), &Target::default(), &OptimizeOptions::default()).unwrap();
    assert_eq!(r.mods.len(), 9);
    assert_eq!(r.mods.last().map(String::as_str), Some("Hush"));
}
