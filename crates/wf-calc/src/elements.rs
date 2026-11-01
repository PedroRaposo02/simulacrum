use wf_data::{DamageMap, DamageType};

/// One elemental contribution, in the order it is applied.
#[derive(Debug, Clone, Copy)]
pub struct ElementInput {
    pub ty: DamageType,
    pub value: f64,
}

/// Combine elements the way the game does: primary elements pair up in slot order,
/// innate elements (passed last by the caller) join after mods, and pre-combined
/// elements (Magnetic Might, spliced rivens, innate Radiation) never pair.
pub fn combine(mod_elements: &[ElementInput], innate: &[ElementInput]) -> DamageMap {
    let mut entries: Vec<(DamageType, f64)> = Vec::new();
    let mut pending: Option<usize> = None;
    let mut out = DamageMap::new();

    for e in mod_elements.iter().chain(innate.iter()) {
        if e.value == 0.0 {
            continue;
        }
        if !e.ty.is_primary_element() {
            *out.entry(e.ty).or_default() += e.value;
            continue;
        }
        if let Some(i) = entries.iter().position(|(t, _)| {
            *t == e.ty || t.components().is_some_and(|(a, b)| a == e.ty || b == e.ty)
        }) {
            entries[i].1 += e.value;
            continue;
        }
        match pending {
            Some(i) => {
                let combined = DamageType::combine(entries[i].0, e.ty)
                    .expect("two different primary elements always combine");
                entries[i] = (combined, entries[i].1 + e.value);
                pending = None;
            }
            None => {
                entries.push((e.ty, e.value));
                pending = Some(entries.len() - 1);
            }
        }
    }
    for (t, v) in entries {
        *out.entry(t).or_default() += v;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use DamageType::*;

    fn el(ty: DamageType, value: f64) -> ElementInput {
        ElementInput { ty, value }
    }

    #[test]
    fn pairs_in_slot_order() {
        let m = combine(&[el(Cold, 1.0), el(Toxin, 1.0), el(Heat, 1.0)], &[]);
        assert_eq!(m.get(&Viral), Some(&2.0));
        assert_eq!(m.get(&Heat), Some(&1.0));
    }

    #[test]
    fn same_element_merges_into_existing_combo() {
        let m = combine(&[el(Cold, 1.0), el(Toxin, 1.0), el(Toxin, 0.5)], &[]);
        assert_eq!(m.get(&Viral), Some(&2.5));
        assert_eq!(m.len(), 1);
    }

    #[test]
    fn innate_combines_last() {
        let m = combine(&[el(Toxin, 1.0)], &[el(Heat, 0.3)]);
        assert_eq!(m.get(&Gas), Some(&1.3));
    }

    #[test]
    fn precombined_stays_separate() {
        let m = combine(&[el(Magnetic, 0.6), el(Heat, 1.0)], &[el(Radiation, 3.0)]);
        assert_eq!(m.get(&Magnetic), Some(&0.6));
        assert_eq!(m.get(&Heat), Some(&1.0));
        assert_eq!(m.get(&Radiation), Some(&3.0));
    }
}
