//! Offline resource assembly and inspection use the application's exact resource implementation.

use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};
use nib_contract::lexicon::LexiconQuery;
use nib_lexicon::{
    pack::{PackOptions, pack},
    query_pack, verify_pack,
};

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Pack(Box<PackArgs>),
    Verify {
        #[arg(long)]
        directory: PathBuf,
    },
    Query {
        #[arg(long)]
        directory: PathBuf,
        #[arg(long)]
        text: String,
        #[arg(long)]
        semantic: bool,
    },
}

#[derive(clap::Args)]
struct PackArgs {
    #[arg(long)]
    input: PathBuf,
    #[arg(long)]
    output: PathBuf,
    #[arg(long)]
    version: String,
    #[arg(long)]
    vectors: Option<PathBuf>,
    #[arg(long)]
    keys: Option<PathBuf>,
    #[arg(long)]
    model_dir: Option<PathBuf>,
    #[arg(long)]
    contract: Option<PathBuf>,
    #[arg(long)]
    sources_json: Option<PathBuf>,
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Pack(args) => {
            let manifest = pack(&PackOptions {
                input: &args.input,
                output: &args.output,
                version: &args.version,
                vectors: args.vectors.as_deref(),
                keys: args.keys.as_deref(),
                model_dir: args.model_dir.as_deref(),
                contract: args.contract.as_deref(),
                sources_json: args.sources_json.as_deref(),
            })?;
            println!("{}", serde_json::to_string_pretty(&manifest)?);
        },
        Command::Verify { directory } => {
            let manifest = verify_pack(&directory)?;
            println!("verified {}", manifest.id);
        },
        Command::Query {
            directory,
            text,
            semantic,
        } => {
            let result = query_pack(
                &directory,
                &LexiconQuery {
                    text,
                    kinds: Vec::new(),
                    semantic,
                    limit: 20,
                    related_to: None,
                },
            )?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        },
    }
    Ok(())
}
