pub mod behaviours;
pub mod elements;
mod engine;
pub mod sweep;
pub mod types;

pub use engine::{compute, compute_resolved, evaluate, resolve_enemy, Resolved, PROGENITOR_BONUS, PROGENITOR_ELEMENTS};
pub use types::*;

#[cfg(test)]
mod tests;
