import { useEffect, useRef, useState } from "react";
import { Bot, Settings2, Square, Trash2, Undo2, X } from "lucide-react";
import type { AgentMessage } from "@/bindings/agent";
import { Button, IconButton } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
import { t, useTranslation } from "@/shared/i18n";
import type { AgentController } from "./use-agent";
import { AgentConnection } from "./agent-connection";
import { AgentComposer } from "./agent-composer";
import { AgentImage } from "./agent-image";
import { AgentApprovalCard } from "./agent-approval";
import { AgentMarkdown } from "./agent-markdown";
import "./styles.css";

const toolLabelKeys = {
  inspect_creation: "agent.tools.inspectCreation",
  resolve_creation: "agent.tools.resolveCreation",
  inspect_model_capabilities: "agent.tools.inspectModelCapabilities",
  edit_prompts: "agent.tools.editPrompts",
  edit_prompt_node: "agent.tools.editPromptNode",
  patch_generation_settings: "agent.tools.patchGenerationSettings",
  search_resources: "agent.tools.searchResources",
  read_resource: "agent.tools.readResource",
  save_prompt_chunk: "agent.tools.savePromptChunk",
  save_creation_preset: "agent.tools.saveCreationPreset",
  organize_resource: "agent.tools.organizeResource",
  list_resource_folders: "agent.tools.listResourceFolders",
  search_lexicon: "agent.tools.searchLexicon",
  attach_resource: "agent.tools.attachResource",
  read_image: "agent.tools.readImage",
  list_image_results: "agent.tools.listImageResults",
  generate_image: "agent.tools.generateImage",
} as const;

/** Tool identifiers remain transport data; the conversation presents domain actions. */
function toolLabel(name: string | null) {
  if (name === null || !Object.hasOwn(toolLabelKeys, name)) return t("agent.tool");
  return t(toolLabelKeys[name as keyof typeof toolLabelKeys]);
}

function messageContent(message: AgentMessage) {
  return message.role === "tool" && message.success === true
    ? t("agent.toolCompleted", { action: toolLabel(message.toolName) })
    : message.content;
}

/** A compact conversation remains usable while the rest of the workspace is locked. */
export function AgentPanel({
  agent,
  open,
  readOnly,
  onClose,
}: {
  agent: AgentController;
  open: boolean;
  readOnly: boolean;
  onClose: () => void;
}) {
  useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const messages = agent.snapshot?.messages ?? [];
  const locked = agent.phase !== "ready";
  const canCancel = locked;
  const last = messages.at(-1);

  useEffect(() => {
    if (open && following.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [open, messages.length, last?.content]);

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        event.target instanceof Node &&
        panel.current?.contains(event.target)
      ) {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  return (
    <aside
      ref={panel}
      id="agent-panel"
      className="agent-panel"
      hidden={!open}
      aria-label={t("agent.title")}
      data-agent-panel
    >
      <div className="agent-panel-header">
        <strong>
          <Bot size={16} aria-hidden />
          {t("agent.title")}
        </strong>
        <div className="button-group">
          <IconButton
            label={t("agent.connection")}
            aria-expanded={settingsOpen}
            aria-controls="agent-connection"
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <Settings2 size={15} aria-hidden />
          </IconButton>
          <IconButton label={t("agent.close")} onClick={onClose}>
            <X size={16} aria-hidden />
          </IconButton>
        </div>
      </div>
      <div className="agent-run-status">
        <output className="agent-state" aria-live="polite">
          {agent.phase === "ready"
            ? t(`agent.${agent.snapshot?.status ?? "idle"}`)
            : t(`agent.${agent.phase}`)}
        </output>
        {canCancel && (
          <Button onClick={() => void agent.cancel()} disabled={agent.cancelling}>
            <Square size={13} aria-hidden />
            {t(agent.cancelling ? "agent.cancelling" : "agent.cancel")}
          </Button>
        )}
      </div>
      {locked && <p className="agent-lock-notice">{t("agent.lockedNotice")}</p>}
      <AgentConnection
        agent={agent}
        disabled={locked || readOnly}
        open={open}
        visible={settingsOpen || agent.connection?.configured === false}
      />
      {/* The conversation needs keyboard focus for scrolling while editing is locked. */}
      {/* oxlint-disable jsx-a11y/no-noninteractive-tabindex */}
      <div
        ref={log}
        className="agent-conversation"
        role="log"
        tabIndex={0}
        aria-label={t("agent.conversation")}
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={() => {
          if (log.current)
            following.current =
              log.current.scrollHeight - log.current.scrollTop - log.current.clientHeight < 60;
        }}
      >
        {!messages.length && <p className="agent-empty">{t("agent.empty")}</p>}
        {messages.map((message) => (
          <article className={`agent-message agent-message-${message.role}`} key={message.id}>
            <div className="agent-message-heading">
              <strong>
                {t(
                  message.role === "user"
                    ? "agent.user"
                    : message.role === "assistant"
                      ? "agent.assistant"
                      : "agent.tool",
                )}
              </strong>
              {message.toolName && <span>{toolLabel(message.toolName)}</span>}
              {message.success !== null && (
                <span className={message.success ? "" : "agent-failure"}>
                  {t(message.success ? "agent.toolSucceeded" : "agent.toolFailed")}
                </span>
              )}
            </div>
            <div className="agent-message-content">
              {message.role === "assistant" ? (
                <AgentMarkdown
                  content={message.content}
                  streaming={agent.snapshot?.status === "running" && last?.id === message.id}
                />
              ) : (
                messageContent(message)
              )}
            </div>
            <div className="agent-message-images">
              {message.assetIds.map((id) => (
                <AgentImage key={id} id={id} />
              ))}
            </div>
          </article>
        ))}
      </div>
      {/* oxlint-enable jsx-a11y/no-noninteractive-tabindex */}
      {(Boolean(agent.error) || agent.snapshot?.error) && (
        <div className="agent-error" role="alert">
          <p>{agent.error ? errorMessage(agent.error) : agent.snapshot?.error}</p>
          <Button onClick={() => void agent.retry()}>{t("agent.retry")}</Button>
        </div>
      )}
      <div className="agent-conversation-actions">
        <Button
          disabled={locked || readOnly || !agent.undoAvailable}
          onClick={() => void agent.undo()}
          title={t("agent.undoHelp")}
        >
          <Undo2 size={14} aria-hidden />
          {t("agent.undo")}
        </Button>
        <IconButton
          label={t("agent.clear")}
          disabled={locked || readOnly || !messages.length}
          onClick={() => void agent.clear()}
        >
          <Trash2 size={14} aria-hidden />
        </IconButton>
        {agent.snapshot?.resourcesUndoAvailable && (
          <Button
            disabled={locked || readOnly || agent.undoAvailable}
            onClick={() => void agent.undoResources()}
            title={t("agent.undoResourcesHelp")}
          >
            <Undo2 size={14} aria-hidden />
            {t("agent.undoResources")}
          </Button>
        )}
      </div>
      <AgentApprovalCard agent={agent} readOnly={readOnly} />
      <AgentComposer agent={agent} disabled={locked || readOnly} />
    </aside>
  );
}
