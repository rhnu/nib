//! FP16 storage is expanded and normalized once; all query arithmetic is FP32.

use std::{collections::HashSet, fs, path::Path};

use anyhow::{Result, ensure};
use wide::f32x8;

use crate::format::DIMENSION;

pub(crate) struct FlatIndex {
    pub(crate) keys: Vec<String>,
    values: Vec<f32>,
}

impl FlatIndex {
    pub(crate) fn load(path: &Path, keys: Vec<String>) -> Result<Self> {
        let bytes = fs::read(path)?;
        ensure!(
            !keys.is_empty() && keys.len().checked_mul(DIMENSION * 2) == Some(bytes.len()),
            "vector row mapping and matrix differ"
        );
        ensure!(
            keys.iter().collect::<HashSet<_>>().len() == keys.len(),
            "duplicate vector identity"
        );
        let mut values: Vec<f32> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|bytes| half::f16::from_le_bytes([bytes[0], bytes[1]]).to_f32())
            .collect();
        for row in values.as_chunks_mut::<DIMENSION>().0 {
            normalize(row)?;
        }
        Ok(Self { keys, values })
    }

    pub(crate) fn search(
        &self,
        query: &[f32],
        limit: usize,
        allowed: impl Fn(&str) -> bool,
    ) -> Vec<(usize, f32)> {
        let mut scores = self
            .values
            .as_chunks::<DIMENSION>()
            .0
            .iter()
            .enumerate()
            .filter(|(row, _)| allowed(&self.keys[*row]))
            .map(|(row, vector)| (row, dot(vector, query)))
            .collect::<Vec<_>>();
        let compare = |left: &(usize, f32), right: &(usize, f32)| {
            right.1.total_cmp(&left.1).then(left.0.cmp(&right.0))
        };
        if scores.len() > limit {
            scores.select_nth_unstable_by(limit, compare);
            scores.truncate(limit);
        }
        scores.sort_unstable_by(compare);
        scores
    }
}

/// Safe portable SIMD avoids relying on an index library's unknown Windows kernel dispatch.
fn dot(left: &[f32], right: &[f32]) -> f32 {
    let mut sum = f32x8::ZERO;
    for (left, right) in left
        .as_chunks::<8>()
        .0
        .iter()
        .zip(right.as_chunks::<8>().0.iter())
    {
        sum += f32x8::from(*left) * f32x8::from(*right);
    }
    sum.reduce_add()
}

pub(crate) fn normalize(values: &mut [f32]) -> Result<()> {
    let norm = values.iter().map(|value| value * value).sum::<f32>().sqrt();
    ensure!(
        values.len() == DIMENSION
            && values.iter().all(|value| value.is_finite())
            && norm.is_finite()
            && norm > 0.0,
        "invalid embedding vector"
    );
    for value in values {
        *value /= norm;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
