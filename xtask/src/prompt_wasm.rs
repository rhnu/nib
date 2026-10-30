//! Build the same prompt implementation consumed by the native application for the Web Worker.

use std::{path::Path, process::Command};

use anyhow::{Context, Result, ensure};

pub(super) fn build() -> Result<()> {
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .context("xtask must live directly inside the workspace root")?;
    let target = workspace.join("target/prompt-wasm");
    let output = workspace.join("apps/desktop/src/bindings/prompt-wasm");
    run(
        Command::new("cargo")
            .current_dir(workspace)
            .args([
                "build",
                "--package",
                "nib-prompt",
                "--target",
                "wasm32-unknown-unknown",
                "--features",
                "wasm",
                "--release",
                "--locked",
                "--target-dir",
            ])
            .arg(&target),
        "compile the shared prompt parser (install the wasm32-unknown-unknown target with rustup)",
    )?;
    run(
        Command::new("wasm-bindgen")
            .current_dir(workspace)
            .arg(target.join("wasm32-unknown-unknown/release/nib_prompt.wasm"))
            .args(["--target", "web", "--out-dir"])
            .arg(output),
        "generate prompt WebAssembly bindings (install the matching wasm-bindgen-cli version)",
    )
}

fn run(command: &mut Command, description: &str) -> Result<()> {
    let status = command.status().with_context(|| description.to_owned())?;
    ensure!(status.success(), "{description}: {status}");
    Ok(())
}
