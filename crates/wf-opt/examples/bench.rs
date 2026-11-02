// Optimizer benchmark: the precompute's work for a few weapons, with timings and the chosen builds
// (to check that speedups don't change results).
// cargo run --release -p wf-opt --example bench -- [data/gamedata.json] [out.txt]
use std::time::Instant;
use wf_calc::{Build, Target};
use wf_opt::{optimize_with_riven, Objective, OptimizeOptions};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let data_path = args.get(1).map_or("data/gamedata.json", |s| s.as_str());
    let data: wf_data::GameData = serde_json::from_str(&std::fs::read_to_string(data_path).unwrap()).unwrap();
    let weapons = ["Laetum", "Braton Prime", "Nikana Prime", "Verglas Prime", "Kuva Bramma", "Ignis Wraith", "Onos", "Acceltra Prime"];
    let target = Target { enemy: Some("sp-grineer".into()), ..Default::default() };
    let mut lines = Vec::new();
    let mut total = 0.0;
    let mut evals = 0u64;
    for name in weapons {
        let Some(w) = data.weapons.iter().find(|w| w.name == name) else {
            eprintln!("missing {name}");
            continue;
        };
        let heavy = w.modes.iter().position(|m| m.melee_role == Some(wf_data::MeleeRole::Heavy));
        let mut variants = vec![("", Objective::Balanced, None), ("group", Objective::Group, None)];
        if let Some(h) = heavy {
            variants.push(("heavy", Objective::Balanced, Some(h)));
        }
        for (label, objective, mode) in variants {
            let t0 = Instant::now();
            let r = optimize_with_riven(&data, &w.id, &Build::default(), &target, &OptimizeOptions { objective, mode, ..Default::default() });
            let dt = t0.elapsed().as_secs_f64();
            total += dt;
            match r {
                Ok((plain, riven)) => {
                    for (suffix, r) in [("", plain), ("riven", riven)] {
                        let tag = match (label, suffix) {
                            ("", "") => "plain".to_string(),
                            ("", s) => s.to_string(),
                            (l, "") => l.to_string(),
                            (l, _) => format!("{l}Riven"),
                        };
                        evals += r.evaluations;
                        let riven_keys: Vec<String> = r.riven.iter().map(|p| p.key.clone()).collect();
                        lines.push(format!(
                            "{name} {tag}: burst {:.1} sustained {:.1} group {:.1} | {} | {:?} | evo {:?} | riven {:?}",
                            r.burst_dps, r.sustained_dps, r.group_dps, r.mods.join(", "), r.arcane, r.evolutions, riven_keys
                        ));
                    }
                    println!("{name:16} {:11} {dt:6.2}s", if label.is_empty() { "single" } else { label });
                }
                Err(e) => {
                    lines.push(format!("{name} {label}: error {}", e.message));
                    println!("{name:16} {label:11} {dt:6.2}s error");
                }
            }
        }
    }
    println!("total {total:.1}s, {evals} evaluations, {:.1} µs per evaluation", total * 1e6 / evals.max(1) as f64);
    if let Some(out) = args.get(2) {
        std::fs::write(out, lines.join("\n") + "\n").unwrap();
    }
}
