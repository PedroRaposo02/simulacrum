use clap::{Parser, Subcommand};
use serde::Deserialize;
use std::path::PathBuf;
use std::process::ExitCode;
use wf_calc::sweep::{diff, sweep, SweepReport};
use wf_calc::{compute, Build, Explain, Target};
use wf_data::GameData;
use wf_opt::{optimize, OptimizeOptions, OptimizeResult, RivenPick};
use rayon::prelude::*;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Parser)]
#[command(name = "wfcalc", about = "Warframe build calculator engine CLI")]
struct Cli {
    #[arg(long, global = true, default_value = "data/gamedata.json")]
    data: PathBuf,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Compute a weapon (optionally with a build file) and print the explanation tree.
    Explain {
        weapon: String,
        #[arg(long)]
        build: Option<PathBuf>,
        /// Mods in slot order, comma separated (alternative to --build).
        #[arg(long, value_delimiter = ',')]
        mods: Vec<String>,
        #[arg(long)]
        arcane: Option<String>,
        /// Incarnon evolutions, comma separated.
        #[arg(long, value_delimiter = ',')]
        evolutions: Vec<String>,
        /// Kuva / Tenet progenitor element (heat, cold, electricity, toxin, impact, magnetic, radiation).
        #[arg(long)]
        progenitor: Option<String>,
        #[arg(long)]
        enemy: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Compute every attack mode of every weapon against reference builds and enemy presets.
    Sweep {
        #[arg(long, default_value = "sweep-report.json")]
        out: PathBuf,
        /// Previous report; DPS changes beyond --threshold are listed.
        #[arg(long)]
        previous: Option<PathBuf>,
        #[arg(long, default_value_t = 0.10)]
        threshold: f64,
    },
    /// Find the theoretical best build for one weapon, or for every weapon with --all.
    Optimize {
        weapon: Option<String>,
        #[arg(long)]
        enemy: Option<String>,
        #[arg(long)]
        riven: bool,
        /// Attack mode index (see `explain`); default: best headline mode.
        #[arg(long)]
        mode: Option<usize>,
        /// Optimize the weapon's heavy attack (melee) at --heavy-combo.
        #[arg(long)]
        heavy: bool,
        #[arg(long, default_value_t = 5.0)]
        heavy_combo: f64,
        /// Objective: balanced | burst | sustained | per-shot | per-charge.
        #[arg(long, default_value = "balanced")]
        objective: String,
        /// Comfort for guns: maximum fire-rate bonus over the unmodded rate (1.5 = +150%).
        #[arg(long)]
        max_fire_rate_bonus: Option<f64>,
        /// Don't force the explosion-radius mod on explosive weapons.
        #[arg(long)]
        no_explosion_mod: bool,
        /// Comfort: minimum modded attack speed / fire rate.
        #[arg(long)]
        min_attack_speed: Option<f64>,
        /// Comfort: accept a range mod if it costs at most this DPS fraction (e.g. 0.05).
        #[arg(long)]
        range_tolerance: Option<f64>,
        /// Realistic mode: total mod capacity (e.g. 60); polarities via --polarities.
        #[arg(long)]
        capacity: Option<f64>,
        /// 9 comma-separated slot polarities (8 normal + exilus), "-" for none.
        #[arg(long, value_delimiter = ',')]
        polarities: Vec<String>,
        /// Every weapon x (raw + every enemy preset) x (with and without riven), written to --out.
        #[arg(long)]
        all: bool,
        #[arg(long, default_value = "data/best-builds.json")]
        out: PathBuf,
    },
    /// Run golden tests in data/golden.
    Golden {
        #[arg(long, default_value = "data/golden")]
        dir: PathBuf,
    },
}

fn load(path: &PathBuf) -> Result<GameData, String> {
    let s = std::fs::read_to_string(path).map_err(|e| format!("{}: {e} (run `pnpm ingest` first)", path.display()))?;
    GameData::from_json(&s).map_err(|e| format!("{}: {e}", path.display()))
}

fn fmt(v: f64) -> String {
    if v.abs() >= 1e6 {
        format!("{:.3}M", v / 1e6)
    } else if v.abs() >= 1e4 {
        format!("{:.1}k", v / 1e3)
    } else if v.abs() >= 10.0 || v == 0.0 {
        format!("{v:.1}")
    } else {
        format!("{v:.4}")
    }
}

fn print_tree(e: &Explain, depth: usize) {
    let detail = e.detail.as_deref().map(|d| format!("  ({d})")).unwrap_or_default();
    println!("{}{}: {}{}", "  ".repeat(depth), e.label, fmt(e.value), detail);
    for c in &e.children {
        print_tree(c, depth + 1);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenFile {
    cases: Vec<GoldenCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenCase {
    name: String,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    build: Option<Build>,
    #[serde(default)]
    target: Target,
    #[serde(default)]
    mode: usize,
    #[serde(default)]
    metric: String,
    #[serde(default)]
    expected: f64,
    #[serde(default = "tol")]
    tolerance: f64,
}

fn tol() -> f64 {
    0.01
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BestEntry {
    mode_index: usize,
    burst_dps: f64,
    mods: Vec<String>,
    arcane: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    riven: Vec<RivenPick>,
    #[serde(skip_serializing_if = "Option::is_none")]
    riven_negative: Option<RivenPick>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    evolutions: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progenitor: Option<wf_data::DamageType>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BestPair {
    #[serde(skip_serializing_if = "Option::is_none")]
    plain: Option<BestEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    riven: Option<BestEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BestBuilds {
    data_version: String,
    generated_at_unix: u64,
    conditions: wf_calc::Conditions,
    /// target id ("raw" or enemy preset id) -> weapon id -> best builds
    targets: BTreeMap<String, BTreeMap<String, BestPair>>,
}

fn entry(r: OptimizeResult) -> BestEntry {
    BestEntry {
        mode_index: r.mode_index,
        burst_dps: r.burst_dps,
        mods: r.mods,
        arcane: r.arcane,
        riven: r.riven,
        riven_negative: r.riven_negative,
        evolutions: r.evolutions,
        progenitor: r.progenitor,
    }
}

fn print_optimized(r: &OptimizeResult) {
    println!("{} / {}: {} burst DPS ({} evaluations)", r.weapon, r.mode, fmt(r.burst_dps), r.evaluations);
    println!(
        "  {:.2} shots/s, per shot {}, sustained {}{}  [objective {:?}: {}]",
        r.fire_rate,
        fmt(r.per_shot),
        fmt(r.sustained_dps),
        r.per_charge.map(|c| format!(", per charge {}", fmt(c))).unwrap_or_default(),
        r.objective,
        fmt(r.score)
    );
    if let Some(a) = r.attack_speed {
        println!(
            "  attack speed {:.2}{}, range {:.2} m{}",
            a,
            if r.below_attack_speed_floor { " (below the floor!)" } else { "" },
            r.range_m.unwrap_or(0.0),
            r.range_cost.map(|c| format!(" (range costs {:.1}% DPS)", c * 100.0)).unwrap_or_default()
        );
    }
    if let Some(d) = r.drain {
        println!("  capacity used {d}");
    }
    for (i, m) in r.mods.iter().enumerate() {
        println!("  {}. {m}", i + 1);
    }
    if let Some(a) = &r.arcane {
        println!("  arcane: {a}");
    }
    if !r.evolutions.is_empty() {
        println!("  evolutions: {}", r.evolutions.join(", "));
    }
    if let Some(p) = r.progenitor {
        println!("  progenitor: {p:?} (60%)");
    }
    for p in &r.riven {
        println!("  riven +{:.1}% {}", p.value * 100.0, p.label);
    }
    if let Some(n) = &r.riven_negative {
        println!("  riven {:.1}% {} (harmless)", n.value * 100.0, n.label);
    }
    println!("  marginal value (DPS this adds on top of the rest):");
    for m in &r.marginal {
        if m.loss >= 1.0 - 1e-9 {
            println!("    {:>7}  {}", "needed", m.label);
        } else {
            println!("    {:>+6.1}%  {}", (1.0 / (1.0 - m.loss) - 1.0) * 100.0, m.label);
        }
    }
}

fn run() -> Result<bool, String> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Explain { weapon, build, mods, arcane, evolutions, progenitor, enemy, json } => {
            let data = load(&cli.data)?;
            let mut b: Build = match build {
                Some(p) => serde_json::from_str(&std::fs::read_to_string(&p).map_err(|e| e.to_string())?)
                    .map_err(|e| format!("{}: {e}", p.display()))?,
                None => Build::default(),
            };
            b.weapon = weapon;
            if !mods.is_empty() {
                b.mods = mods.into_iter().map(|m| m.trim().to_string()).collect();
            }
            if arcane.is_some() {
                b.arcane = arcane;
            }
            if !evolutions.is_empty() {
                b.evolutions = evolutions.into_iter().map(|e| e.trim().to_string()).collect();
            }
            if let Some(p) = progenitor {
                b.progenitor = Some(serde_json::from_value(serde_json::Value::String(p.to_lowercase())).map_err(|e| format!("progenitor: {e}"))?);
            }
            let target = Target { enemy, ..Default::default() };
            let res = compute(&data, &b, &target).map_err(|e| e.to_string())?;
            if json {
                println!("{}", serde_json::to_string_pretty(&res).unwrap());
                return Ok(true);
            }
            println!("{} vs {}", res.weapon, res.target);
            for w in &res.warnings {
                println!("  warning: {w}");
            }
            for m in &res.modes {
                println!("\n== {} [{:?}] ==", m.mode, m.coverage);
                println!(
                    "per shot {} | burst {} DPS | sustained {} DPS{} | status ~{} DPS",
                    fmt(m.per_shot),
                    fmt(m.burst_dps),
                    fmt(m.sustained_dps),
                    m.per_charge.map(|c| format!(" | per charge {}", fmt(c))).unwrap_or_default(),
                    fmt(m.status_dps)
                );
                for a in &m.approximations {
                    println!("  approx: {a}");
                }
                print_tree(&m.explain, 1);
            }
            for f in &res.failed_modes {
                println!("
== {} [Unsupported] ==
  {}", f.mode, f.error);
            }
            Ok(true)
        }
        Cmd::Sweep { out, previous, threshold } => {
            let data = load(&cli.data)?;
            let mut enemies: Vec<Option<String>> = vec![None];
            enemies.extend(data.enemies.iter().map(|e| Some(e.id.clone())));
            let report = sweep(&data, &enemies);
            std::fs::write(&out, serde_json::to_string_pretty(&report).unwrap()).map_err(|e| e.to_string())?;
            println!(
                "{} weapons, {} attack modes, {} results, {} failures -> {}",
                report.weapons,
                report.attack_modes,
                report.entries.len(),
                report.failures.len(),
                out.display()
            );
            for f in &report.failures {
                println!("  FAIL {} [{}] {}", f.fingerprint, f.build, f.error);
            }
            let mut seen = std::collections::BTreeSet::new();
            for (e, ratio) in &report.outliers {
                if seen.insert((&e.weapon, &e.mode)) {
                    println!("  IMPLAUSIBLE? {} / {}: {:.0}x the median [{} vs {}]", e.weapon, e.mode, ratio, e.build, e.enemy);
                }
            }
            let mut regressions = 0;
            if let Some(p) = previous {
                let old: SweepReport = serde_json::from_str(&std::fs::read_to_string(&p).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
                for (e, change) in diff(&old, &report, threshold) {
                    println!("  CHANGED {:+.1}% {} / {} [{} vs {}]", change * 100.0, e.weapon, e.mode, e.build, e.enemy);
                }
                for f in &report.failures {
                    if !old.failures.iter().any(|o| o.fingerprint == f.fingerprint) {
                        println!("  NEW FAILURE {}", f.fingerprint);
                        regressions += 1;
                    }
                }
            }
            Ok(regressions == 0)
        }
        Cmd::Optimize { weapon, enemy, riven, all, out, mode, heavy, heavy_combo, objective, max_fire_rate_bonus, no_explosion_mod, min_attack_speed, range_tolerance, capacity, polarities } => {
            let data = load(&cli.data)?;
            if !all {
                let w = weapon.ok_or("give a weapon name or --all")?;
                let target = Target { enemy, ..Default::default() };
                let wd = data.weapon(&w).ok_or("unknown weapon")?;
                let mode = if heavy {
                    Some(wd.modes.iter().position(|m| m.melee_role == Some(wf_data::MeleeRole::Heavy)).ok_or("no heavy attack mode")?)
                } else {
                    mode
                };
                let mut base = Build::default();
                base.conditions.heavy_combo_multiplier = heavy_combo;
                let cap = capacity.map(|c| wf_opt::CapacityOptions {
                    capacity: c,
                    polarities: (0..9)
                        .map(|i| polarities.get(i).filter(|p| p.as_str() != "-" && !p.is_empty()).cloned())
                        .collect(),
                    ..Default::default()
                });
                let objective = match objective.as_str() {
                    "sustained" => wf_opt::Objective::Sustained,
                    "per-shot" => wf_opt::Objective::PerShot,
                    "per-charge" => wf_opt::Objective::PerCharge,
                    "burst" => wf_opt::Objective::Burst,
                    _ => wf_opt::Objective::Balanced,
                };
                let opts = OptimizeOptions {
                    riven,
                    mode,
                    objective,
                    max_fire_rate_bonus,
                    explosion_mod: !no_explosion_mod,
                    min_attack_speed,
                    range_tolerance,
                    capacity: cap,
                    ..Default::default()
                };
                let t0 = std::time::Instant::now();
                let r = optimize(&data, &w, &base, &target, &opts).map_err(|e| e.to_string())?;
                print_optimized(&r);
                println!("  took {:.2}s", t0.elapsed().as_secs_f64());
                return Ok(true);
            }
            let mut targets: Vec<(String, Target)> = vec![("raw".into(), Target::default())];
            targets.extend(data.enemies.iter().map(|e| (e.id.clone(), Target { enemy: Some(e.id.clone()), ..Default::default() })));
            let t0 = std::time::Instant::now();
            let jobs: Vec<(usize, usize)> = (0..targets.len()).flat_map(|t| (0..data.weapons.len()).map(move |w| (t, w))).collect();
            let done = std::sync::atomic::AtomicUsize::new(0);
            let results: Vec<(usize, String, BestPair)> = jobs
                .par_iter()
                .map(|&(ti, wi)| {
                    let w = &data.weapons[wi];
                    let t = &targets[ti].1;
                    let run = |riven| optimize(&data, &w.id, &Build::default(), t, &OptimizeOptions { riven, ..Default::default() });
                    let pair = match run(false) {
                        Ok(p) => BestPair { plain: Some(entry(p)), riven: run(true).ok().map(entry), error: None },
                        Err(e) => BestPair { plain: None, riven: None, error: Some(e.message) },
                    };
                    let n = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                    if n % 200 == 0 {
                        eprintln!("  {n}/{} ({:.0}s)", jobs.len(), t0.elapsed().as_secs_f64());
                    }
                    (ti, w.id.clone(), pair)
                })
                .collect();
            let mut out_map: BTreeMap<String, BTreeMap<String, BestPair>> = BTreeMap::new();
            let mut errors = 0;
            for (ti, wid, pair) in results {
                errors += usize::from(pair.error.is_some());
                out_map.entry(targets[ti].0.clone()).or_default().insert(wid, pair);
            }
            let best = BestBuilds {
                data_version: data.version.clone(),
                generated_at_unix: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs()),
                conditions: wf_calc::Conditions::default(),
                targets: out_map,
            };
            std::fs::write(&out, serde_json::to_string(&best).unwrap()).map_err(|e| e.to_string())?;
            println!(
                "{} weapons x {} targets optimized in {:.1}s ({} weapon/target pairs not computable) -> {}",
                data.weapons.len(),
                targets.len(),
                t0.elapsed().as_secs_f64(),
                errors,
                out.display()
            );
            Ok(true)
        }
        Cmd::Golden { dir } => {
            let data = load(&cli.data)?;
            let mut ok = true;
            let mut entries: Vec<_> = std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten().collect();
            entries.sort_by_key(|e| e.path());
            for entry in entries {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                let file: GoldenFile = serde_json::from_str(&std::fs::read_to_string(&path).map_err(|e| e.to_string())?)
                    .map_err(|e| format!("{}: {e}", path.display()))?;
                for c in file.cases {
                    if let Some(s) = &c.status {
                        println!("SKIP {} ({s})", c.name);
                        continue;
                    }
                    let Some(build) = &c.build else { continue };
                    let actual = match compute(&data, build, &c.target) {
                        Ok(r) => {
                            let Some(m) = r.modes.get(c.mode) else {
                                println!("FAIL {}: no mode {}", c.name, c.mode);
                                ok = false;
                                continue;
                            };
                            match c.metric.as_str() {
                                "perShot" => m.per_shot,
                                "sustainedDps" => m.sustained_dps,
                                _ => m.burst_dps,
                            }
                        }
                        Err(e) => {
                            println!("FAIL {}: {e}", c.name);
                            ok = false;
                            continue;
                        }
                    };
                    let rel = (actual - c.expected).abs() / c.expected.abs().max(1e-9);
                    let pass = rel <= c.tolerance;
                    ok &= pass;
                    println!(
                        "{} {}: expected {} got {} ({:+.2}%)",
                        if pass { "PASS" } else { "FAIL" },
                        c.name,
                        fmt(c.expected),
                        fmt(actual),
                        (actual / c.expected - 1.0) * 100.0
                    );
                }
            }
            Ok(ok)
        }
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(2),
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
