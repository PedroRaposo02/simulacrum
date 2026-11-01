use clap::{Parser, Subcommand};
use serde::Deserialize;
use std::path::PathBuf;
use std::process::ExitCode;
use wf_calc::sweep::{diff, sweep, SweepReport};
use wf_calc::{compute, Build, Explain, Target};
use wf_data::GameData;

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

fn run() -> Result<bool, String> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Explain { weapon, build, mods, arcane, enemy, json } => {
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
