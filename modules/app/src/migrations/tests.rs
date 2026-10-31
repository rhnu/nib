use super::{DatabaseMigrations, Migration};
use crate::persistence::PersistenceError;

const HISTORY: DatabaseMigrations = DatabaseMigrations {
    name: "test",
    current: 3,
    steps: &[
        Migration {
            from: 1,
            apply: |_| unreachable!("planning does not execute upgrades"),
        },
        Migration {
            from: 2,
            apply: |_| unreachable!("planning does not execute upgrades"),
        },
    ],
};

#[test]
fn selects_every_required_upgrade_in_order() {
    let steps = HISTORY.pending(1).unwrap();
    assert_eq!(
        steps.iter().map(|step| step.from).collect::<Vec<_>>(),
        [1, 2]
    );
    assert_eq!(HISTORY.pending(2).unwrap().len(), 1);
    assert!(HISTORY.pending(3).unwrap().is_empty());
}

#[test]
fn rejects_unversioned_and_newer_databases() {
    for found in [-1, 0, 4] {
        assert!(
            matches!(HISTORY.pending(found), Err(PersistenceError::UnsupportedSchema { found: actual }) if actual == found)
        );
    }
}

#[test]
fn rejects_missing_and_out_of_order_upgrades_before_execution() {
    for steps in [
        &HISTORY.steps[..1],
        &HISTORY.steps[1..],
        &[
            Migration {
                from: 1,
                apply: |_| unreachable!(),
            },
            Migration {
                from: 1,
                apply: |_| unreachable!(),
            },
        ],
    ] {
        let history = DatabaseMigrations { steps, ..HISTORY };
        assert!(matches!(
            history.pending(1),
            Err(PersistenceError::UnsupportedSchema { found: 1 })
        ));
    }
}
