use super::*;

#[test]
fn preview_budget_caps_bytes_and_throttles_each_sample_independently() {
    let mut budget = PreviewBudget::default();
    let now = Instant::now();
    assert!(!budget.accept(0, 5 * 1024 * 1024, now));
    assert!(budget.accept(0, 20, now));
    assert!(!budget.accept(0, 20, now + Duration::from_millis(50)));
    assert!(budget.accept(1, 20, now + Duration::from_millis(50)));
    assert!(budget.accept(0, 20, now + Duration::from_millis(100)));
}
