//! Typed application tools with domain validation and permission-controlled generation.

use std::sync::{Arc, atomic::Ordering};

use rig_core::{
    message::ToolName,
    tool::{DynamicTool, ToolExecutionError, ToolOutput},
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    AgentError,
    runtime::{AgentRuntime, message},
};
use crate::{
    library::{ResourceQuery, ResourceSaveMode, ResourceSearch as _, ResourceSort},
    prompt::{
        GenerationSettings, PresetBinding, PresetInstance, PromptNode, Resource, ResourceContent,
        ResourceReader as _,
    },
    session::DraftLease,
    state::AppState,
};

mod edits;

#[derive(Clone, Copy)]
enum Operation {
    Current,
    Resolve,
    Capabilities,
    Prompts,
    Node,
    Settings,
    Search,
    Resource,
    Chunk,
    Preset,
    Metadata,
    Folders,
    Lexicon,
    Attach,
}

#[expect(
    clippy::too_many_lines,
    reason = "the finite tool catalog keeps each public schema beside its declared operation"
)]
pub(super) fn tools(
    runtime: &Arc<AgentRuntime>,
    app: &AppState,
    lease: &Arc<DraftLease>,
) -> Vec<DynamicTool> {
    let string = json!({"type":"string"});
    let optional = json!({"type":["string","null"]});
    let strings = json!({"anyOf":[{"type":"array","items":{"type":"string"}},{"type":"null"}]});
    let specs = [
        (
            "inspect_creation",
            "Read the saved current creation, its epoch and undo state.",
            Operation::Current,
            json!({}),
            vec![],
        ),
        (
            "resolve_creation",
            "Resolve resources and presets and inspect syntax diagnostics, without generating images or spending Anlas.",
            Operation::Resolve,
            json!({}),
            vec![],
        ),
        (
            "inspect_model_capabilities",
            "Read SDK model defaults, generation limits and supported options for the current creation.",
            Operation::Capabilities,
            json!({}),
            vec![],
        ),
        (
            "edit_prompts",
            "Append or replace direct positive and/or negative prompt text. Null preserves that side; append=false replaces direct nodes on that side. Presets and characters remain.",
            Operation::Prompts,
            json!({"positive":optional,"negative":optional,"append":{"type":"boolean"}}),
            vec!["append"],
        ),
        (
            "edit_prompt_node",
            "Edit a stable node in the creation, character, or preset instance. Omit instanceId for direct creation and characterId for base prompts. For linked presets use original IDs from read_resource; changes are instance overrides, never original edits. Null text/enabled preserves it.",
            Operation::Node,
            json!({"instanceId":optional,"characterId":optional,"nodeId":string,"text":optional,"enabled":{"type":["boolean","null"]}}),
            vec!["nodeId"],
        ),
        (
            "patch_generation_settings",
            "Change only supplied direct setting overrides. Omitted fields remain; null restores inheritance; false/zero are real values. SDK owns legal model values. These are declared generation fields, not JSON paths.",
            Operation::Settings,
            json!({"settings":settings_schema()}),
            vec!["settings"],
        ),
        (
            "search_resources",
            "Search saved chunks and presets by name or aliases. At most 40 results. kind may be chunk, preset or null.",
            Operation::Search,
            json!({"text":string,"kind":{"type":["string","null"],"enum":["chunk","preset",null]},"folderId":optional}),
            vec!["text"],
        ),
        (
            "read_resource",
            "Read a saved resource definition by its stable UUID.",
            Operation::Resource,
            json!({"id":string}),
            vec!["id"],
        ),
        (
            "save_prompt_chunk",
            "Create a reusable prompt chunk, or update an existing chunk by id. Null id allocates a UUID. Existing metadata remains on update.",
            Operation::Chunk,
            json!({"id":optional,"name":string,"text":string}),
            vec!["name", "text"],
        ),
        (
            "save_creation_preset",
            "Save the full creation as a self-contained preset: expand linked presets/chunks, preserve disabled text/characters/references and effective settings. Creation remains unchanged. A supplied id updates that preset, preserving metadata.",
            Operation::Preset,
            json!({"id":optional,"name":string}),
            vec!["name"],
        ),
        (
            "organize_resource",
            "Edit only supplied resource metadata. Omitted/null name/description/tags/aliases/models remain. move=true changes folder; folderId=null moves to root. Conditional undo is supported.",
            Operation::Metadata,
            json!({"id":string,"name":optional,"description":optional,"tags":strings,"aliases":strings,"models":strings,"move":{"type":"boolean"},"folderId":optional}),
            vec!["id", "move"],
        ),
        (
            "list_resource_folders",
            "List existing resource folders and stable UUIDs. Deleting resources or folders is unsupported.",
            Operation::Folders,
            json!({}),
            vec![],
        ),
        (
            "search_lexicon",
            "Search the installed local vocabulary, optionally with semantic similarity. Returns canonical prompt text and availability, at most 30 matches.",
            Operation::Lexicon,
            json!({"text":string,"semantic":{"type":"boolean"}}),
            vec!["text", "semantic"],
        ),
        (
            "attach_resource",
            "Append a linked chunk to positive/negative prompt or append a linked preset. Kind is read from storage. Does not duplicate or modify its definition.",
            Operation::Attach,
            json!({"id":string,"negative":{"type":"boolean"}}),
            vec!["id", "negative"],
        ),
    ];
    let mut tools: Vec<_> = specs.into_iter().map(|(name,description,op,properties,required)| {
        let runtime=Arc::clone(runtime); let app=app.clone(); let lease=Arc::clone(lease);
        DynamicTool::new(ToolName::new(name).expect("static tool names are nonempty"),description,json!({"type":"object","properties":properties,"required":required,"additionalProperties":false}),move |arguments| {
            let runtime=Arc::clone(&runtime); let app=app.clone(); let lease=Arc::clone(&lease);
            Box::pin(async move {
                if arguments.to_string().len()>128*1024 {return Err(ToolExecutionError::invalid_args("Tool arguments exceeded 128 KiB. Use smaller edits."));}
                if runtime.cancelled.load(Ordering::Acquire) || runtime.storage_failed.load(Ordering::Acquire) {return Err(ToolExecutionError::invalid_args("The assistant has stopped; this operation was not executed."));}
                let access=app.write_access().await.map_err(|_error|ToolExecutionError::invalid_args("Creation data is not writable during relocation or before restart."))?;
                let activity=runtime.tool_activity();
                let result=tokio::task::spawn_blocking(move || {
                    let _activity=activity;
                    let _access=access;
                    if runtime.cancelled.load(Ordering::Acquire) {return Err(AgentError::Cancelled);}
                    let result=execute(op,arguments,&runtime,&app,&lease);
                    let (mut output,success)=match result {Ok(output)=>(json!({"ok":true,"result":output}),true),Err(error)=>(json!({"ok":false,"error":tool_error(&error)}),false)};
                    let mut chat=runtime.chat.lock().map_err(|_error|AgentError::Locked)?;
                    let content=match &output["error"] {Value::String(error)=>error.clone(),_=>format!("{name}: completed successfully")};
                    chat.snapshot.messages.push(message("tool",content,Some(name.into()),Some(success)));
                    chat.snapshot.resources_undo_available = !chat.edits.is_empty();
                    if let Err(error)=runtime.database.save_agent_chat(&chat) {runtime.storage_failed.store(true,Ordering::Release);return Err(error.into());}
                    if output.to_string().len()>64*1024 {output=json!({"ok":success,"detailsOmitted":true,"summary":"The operation completed; its detailed result exceeded 64 KiB. Inspect a narrower scope for details."});}
                    tracing::debug!(tool=name,success,"assistant domain tool finished");
                    Ok::<_,AgentError>(output)
                }).await.map_err(|_error|ToolExecutionError::invalid_args("The local tool worker failed. Inspect the saved creation before retrying."))?;
                result.map(ToolOutput::json).map_err(|error|ToolExecutionError::invalid_args(error.safe_message()))
            })
        })
    }).collect();
    tools.extend(super::images::tools(runtime, app));
    tools.push(super::generation::tool(runtime, app, lease));
    tools
}

/// Records rich tool outputs by asset identity, keeping bytes out of IPC and durable chat state.
pub(super) fn record_output(
    runtime: &AgentRuntime,
    name: &str,
    result: Result<ToolOutput, AgentError>,
    asset_ids: Vec<String>,
) -> Result<ToolOutput, ToolExecutionError> {
    let (output, success, content) = match result {
        Ok(output) => {
            let success = !output.as_content().iter().any(|part| matches!(part, rig_core::message::ToolResultContent::Json { value } if value.get("ok").and_then(Value::as_bool) == Some(false)));
            let content = if success {
                format!("{name}: completed successfully")
            } else {
                "Some generation jobs failed, were cancelled or were interrupted. Inspect the generation queue for details.".into()
            };
            (output, success, content)
        },
        Err(error) => {
            let content = tool_error(&error);
            (
                ToolOutput::json(json!({"ok":false,"error":content})),
                false,
                content,
            )
        },
    };
    let mut chat = runtime
        .chat
        .lock()
        .map_err(|_error| ToolExecutionError::other("Assistant state is unavailable."))?;
    let mut record = message("tool", content, Some(name.into()), Some(success));
    record.asset_ids = asset_ids;
    chat.snapshot.messages.push(record);
    if runtime.database.save_agent_chat(&chat).is_err() {
        runtime.storage_failed.store(true, Ordering::Release);
        return Err(ToolExecutionError::other(
            "The tool result could not be saved.",
        ));
    }
    tracing::debug!(tool = name, success, "assistant domain tool finished");
    Ok(output)
}

fn tool_error(error: &AgentError) -> String {
    match error {
        AgentError::Persistence(error) => error.user_message().to_string(),
        AgentError::Generation(error) => error.user_message().to_string(),
        _ => error.safe_message().into(),
    }
}

fn parse<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, AgentError> {
    serde_json::from_value(value).map_err(|_error|AgentError::Invalid("The tool arguments do not match the declared domain fields. Inspect the schema and retry."))
}

fn value(value: impl serde::Serialize) -> Result<Value, AgentError> {
    serde_json::to_value(value)
        .map_err(|_error| AgentError::Invalid("The local domain result could not be represented."))
}

#[expect(
    clippy::too_many_lines,
    reason = "each explicit domain operation keeps its typed argument shape and side effects together"
)]
fn execute(
    op: Operation,
    args: Value,
    runtime: &AgentRuntime,
    app: &AppState,
    lease: &DraftLease,
) -> Result<Value, AgentError> {
    let database = runtime.database.as_ref();
    // Rig uses tool_concurrency(1), so sibling tools cannot race a snapshot-to-save edit.
    match op {
        Operation::Current => {
            let current = lease.snapshot()?;
            Ok(
                json!({"epoch":current.epoch,"composition":current.draft.composition,"presets":current.draft.presets,"settings":current.draft.settings,"characters":current.draft.characters,"inputs":current.draft.inputs}),
            )
        },
        Operation::Resolve | Operation::Capabilities => {
            let draft = lease.snapshot()?.draft;
            let resolved = database
                .read_resources(|resources| crate::prompt::resolve_draft(&draft, resources))?;
            if matches!(op, Operation::Capabilities) {
                value(crate::api::model_capabilities(&resolved))
            } else {
                value(resolved)
            }
        },
        Operation::Prompts => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct Args {
                positive: Option<String>,
                negative: Option<String>,
                append: bool,
            }
            let args: Args = parse(args)?;
            let mut draft = lease.snapshot()?.draft;
            for (text, nodes) in [
                (args.positive, &mut draft.composition.positive),
                (args.negative, &mut draft.composition.negative),
            ] {
                if let Some(text) = text {
                    if !args.append {
                        nodes.clear();
                    }
                    if !text.is_empty() {
                        nodes.push(PromptNode::Text {
                            id: uuid::Uuid::new_v4().to_string(),
                            enabled: true,
                            text,
                        });
                    }
                }
            }
            value(lease.save(database, &draft)?)
        },
        Operation::Node => {
            let args: edits::NodeEdit = parse(args)?;
            let mut draft = lease.snapshot()?.draft;
            database.read_resources(|resources| edits::edit_node(&mut draft, &args, resources))?;
            value(lease.save(database, &draft)?)
        },
        Operation::Settings => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Args {
                settings: serde_json::Map<String, Value>,
            }
            let args: Args = parse(args)?;
            let mut draft = lease.snapshot()?.draft;
            edits::patch_settings(&mut draft.settings, args.settings)?;
            value(lease.save(database, &draft)?)
        },
        Operation::Search => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct Args {
                text: String,
                kind: Option<crate::library::ResourceKind>,
                folder_id: Option<String>,
            }
            let args: Args = parse(args)?;
            value(database.search_resources(&ResourceQuery {
                text: args.text,
                kind: args.kind,
                tags: vec![],
                models: vec![],
                folder_id: args.folder_id,
                include_subfolders: true,
                root_only: false,
                offset: 0,
                limit: 40,
                sort: ResourceSort::Name,
                descending: false,
            })?)
        },
        Operation::Resource => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Args {
                id: String,
            }
            let args: Args = parse(args)?;
            value(require_resource(database, &args.id)?)
        },
        Operation::Chunk | Operation::Preset => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Args {
                id: Option<String>,
                name: String,
                text: Option<String>,
            }
            let args: Args = parse(args)?;
            let (mut resource, mode) = if let Some(id) = args.id {
                (require_resource(database, &id)?, ResourceSaveMode::Update)
            } else {
                (
                    Resource {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: String::new(),
                        description: String::new(),
                        aliases: vec![],
                        tags: vec![],
                        models: vec![],
                        folder_id: None,
                        cover_asset_id: None,
                        created_at: 0,
                        updated_at: 0,
                        content: ResourceContent::Chunk {
                            text: String::new(),
                        },
                    },
                    ResourceSaveMode::Create,
                )
            };
            if matches!(mode, ResourceSaveMode::Update)
                && matches!(op, Operation::Chunk)
                    != matches!(resource.content, ResourceContent::Chunk { .. })
            {
                return Err(AgentError::Invalid(
                    "The resource has a different kind. Create a new resource instead.",
                ));
            }
            resource.name = args.name;
            resource.content = if matches!(op, Operation::Chunk) {
                ResourceContent::Chunk {
                    text: args
                        .text
                        .ok_or(AgentError::Invalid("A prompt chunk needs text."))?,
                }
            } else {
                let draft = lease.snapshot()?.draft;
                database.read_resources(|resources| edits::preset_content(&draft, resources))?
            };
            let mut chat = runtime.chat.lock().map_err(|_error| AgentError::Locked)?;
            value(database.save_agent_resource(&resource, mode, &mut chat)?)
        },
        Operation::Metadata => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct Args {
                id: String,
                name: Option<String>,
                description: Option<String>,
                tags: Option<Vec<String>>,
                aliases: Option<Vec<String>>,
                models: Option<Vec<String>>,
                #[serde(rename = "move")]
                moving: bool,
                folder_id: Option<String>,
            }
            let args: Args = parse(args)?;
            let mut resource = require_resource(database, &args.id)?;
            if let Some(name) = args.name {
                resource.name = name;
            }
            if let Some(description) = args.description {
                resource.description = description;
            }
            if let Some(tags) = args.tags {
                resource.tags = tags;
            }
            if let Some(aliases) = args.aliases {
                resource.aliases = aliases;
            }
            if let Some(models) = args.models {
                resource.models = models;
            }
            if args.moving {
                resource.folder_id = args.folder_id;
            }
            let mut chat = runtime.chat.lock().map_err(|_error| AgentError::Locked)?;
            value(database.save_agent_resource(&resource, ResourceSaveMode::Update, &mut chat)?)
        },
        Operation::Folders => value(database.list_resource_folders()?),
        Operation::Lexicon => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Args {
                text: String,
                semantic: bool,
            }
            let args: Args = parse(args)?;
            value(app.lexicon().search(crate::lexicon::LexiconQuery {text:args.text,semantic:args.semantic,kinds:vec![],limit:30,related_to:None}).map_err(|error|match error {crate::lexicon::LexiconError::Unavailable(_)=>AgentError::Invalid("The local vocabulary or semantic component is not installed or unavailable."),_=>AgentError::Invalid("The local vocabulary query failed.")})?)
        },
        Operation::Attach => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Args {
                id: String,
                negative: bool,
            }
            let args: Args = parse(args)?;
            let resource = require_resource(database, &args.id)?;
            let mut draft = lease.snapshot()?.draft;
            match resource.content {
                ResourceContent::Chunk { .. } => {
                    let nodes = if args.negative {
                        &mut draft.composition.negative
                    } else {
                        &mut draft.composition.positive
                    };
                    nodes.push(PromptNode::Chunk {
                        id: uuid::Uuid::new_v4().to_string(),
                        enabled: true,
                        resource_id: resource.id,
                        override_text: None,
                    });
                },
                ResourceContent::Preset { .. } => draft.presets.push(PresetInstance {
                    id: uuid::Uuid::new_v4().to_string(),
                    enabled: true,
                    binding: PresetBinding::Linked {
                        resource_id: resource.id,
                        overrides: vec![],
                        settings_overrides: GenerationSettings::default(),
                        output_overrides: crate::prompt::PresetOutputOverrides::default(),
                    },
                }),
            }
            value(lease.save(database, &draft)?)
        },
    }
}

fn require_resource(
    database: &crate::persistence::SqliteDatabase,
    id: &str,
) -> Result<Resource, AgentError> {
    database.get_resource(id)?.ok_or_else(|| {
        crate::persistence::PersistenceError::NotFound {
            kind: "resource",
            id: id.into(),
        }
        .into()
    })
}

fn settings_schema() -> Value {
    let mut properties = serde_json::Map::new();
    for name in [
        "model",
        "sampler",
        "quality",
        "ucPreset",
        "noiseSchedule",
        "imageFormat",
        "alphaMode",
        "responseFormat",
    ] {
        properties.insert(name.into(), json!({"type":["string","null"]}));
    }
    for name in ["steps", "seed", "nSamples"] {
        properties.insert(name.into(), json!({"type":["integer","null"]}));
    }
    for name in ["scale", "cfgRescale"] {
        properties.insert(name.into(), json!({"type":["number","null"]}));
    }
    for name in [
        "legacyUc",
        "transparentBackground",
        "furryMode",
        "varietyBoost",
        "decrisp",
        "smea",
        "smeaDyn",
        "useCoords",
    ] {
        properties.insert(name.into(), json!({"type":["boolean","null"]}));
    }
    properties.insert("size".into(),json!({"anyOf":[{"type":"object","properties":{"width":{"type":"integer"},"height":{"type":"integer"}},"required":["width","height"],"additionalProperties":false},{"type":"null"}]}));
    json!({"type":"object","properties":properties,"additionalProperties":false})
}
