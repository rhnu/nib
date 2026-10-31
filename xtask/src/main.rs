use anyhow::Result;
use clap::{Parser, Subcommand};

mod prompt_wasm;
mod resources;
mod types;

/// Development tasks for the nib workspace.
#[derive(Parser)]
#[command(name = "cargo xtask", version, about)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Verify and publish independently versioned downloadable resources.
    Resources {
        #[command(subcommand)]
        task: resources::Task,
    },
    /// Build the shared prompt parser for the desktop Web Worker.
    PromptWasm,
    /// Generate TypeScript bindings from the Rust API types.
    Types {
        /// Verify committed bindings without writing files.
        #[arg(long)]
        check: bool,
    },
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Resources { task } => resources::run(task),
        Command::PromptWasm => prompt_wasm::build(),
        Command::Types { check } => types::run(check),
    }
}
