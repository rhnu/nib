use super::*;

#[test]
fn exact_search_respects_filter_and_orders_cosine_similarity() {
    let mut values = vec![0.0; DIMENSION * 3];
    values[0] = 1.0;
    values[DIMENSION + 1] = 1.0;
    values[DIMENSION * 2] = -1.0;
    let index = FlatIndex {
        keys: vec!["a".into(), "b".into(), "c".into()],
        values,
    };
    let mut query = vec![0.0; DIMENSION];
    query[0] = 1.0;
    assert_eq!(index.search(&query, 2, |_| true), vec![(0, 1.0), (1, 0.0)]);
    assert_eq!(
        index.search(&query, 2, |key| key != "a"),
        vec![(1, 0.0), (2, -1.0)]
    );
}

#[test]
fn rejects_zero_and_nonfinite_vectors() {
    assert!(normalize(&mut vec![0.0; DIMENSION]).is_err());
    assert!(normalize(&mut vec![f32::NAN; DIMENSION]).is_err());
    let mut vector = vec![2.0; DIMENSION];
    normalize(&mut vector).unwrap();
    assert!((vector.iter().map(|value| value * value).sum::<f32>() - 1.0).abs() < 0.0001);
}
