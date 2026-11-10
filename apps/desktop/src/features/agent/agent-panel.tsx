import { Button, IconButton, Col, Row, ButtonGroup, Modal, notify } from "@/shared/ui";

import { useEffect, useRef, useState } from "react";
import { Bot, Settings2, Square, Trash2, Undo2, X, History, Plus } from "lucide-react";
import type { AgentMessage } from "@/bindings/agent";

import { errorMessage } from "@/shared/host/error";
import { t, useTranslation } from "@/shared/i18n";
import type { AgentController } from "./use-agent";
import { useAgentSettings } from "./use-agent-settings";
import { AgentComposer } from "./agent-composer";
import { AgentImage } from "./agent-image";
import { AgentApprovalCard } from "./agent-approval";
import { AgentMarkdown } from "./agent-markdown";
import "./styles.css";

const toolLabelKeys = {
  inspect_creation: "agent.tools.inspectCreation",
  list_skills: "agent.tools.listSkills",
  read_skill: "agent.tools.readSkill",
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
  if (name === null) return t("agent.tool");
  if (!Object.hasOwn(toolLabelKeys, name)) return name;
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
  onSettings,
}: {
  agent: AgentController;
  open: boolean;
  readOnly: boolean;
  onClose: () => void;
  onSettings: () => void;
}) {
  useTranslation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const settings = useAgentSettings();
  const panel = useRef<HTMLElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const messages = agent.snapshot?.messages ?? [];
  const currentSession = agent.sessions.find((session) => session.id === agent.snapshot?.sessionId);
  const locked = agent.phase !== "ready" || agent.sessionBusy;
  const canCancel = agent.phase === "preparing" || agent.phase === "running";
  const last = messages.at(-1);
  const failure = agent.error ? errorMessage(agent.error) : agent.snapshot?.error;

  useEffect(() => {
    if (failure) notify(() => failure, "agent-run-error", true);
  }, [failure]);

  useEffect(() => {
    following.current = true;
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [agent.snapshot?.sessionId]);

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
    <Col
      gap={0}
      as="aside"
      ref={panel}
      id="agent-panel"
      className="agent-panel [flex:0_0_clamp(320px,_27vw,_390px)] min-w-0 min-h-0 [border-left:1px_solid_var(--line)] bg-panel overflow-hidden [&[hidden]]:hidden max-[1050px]:absolute max-[1050px]:[z-index:40] max-[1050px]:[inset:0_0_0_auto] max-[1050px]:[width:min(390px,_100%)] max-[1050px]:[box-shadow:var(--shadow)]"
      hidden={!open}
      aria-label={t("agent.title")}
      data-agent-panel
    >
      <Row
        gap={2}
        align="center"
        justify="between"
        className="agent-panel-header py-space-2 px-[10px] [border-bottom:1px_solid_var(--line-subtle)]"
      >
        <Row align="center" as="strong" gap={2} className="min-w-0">
          <Bot size={16} aria-hidden />
          <span className="truncate" title={currentSession?.title || t("agent.title")}>
            {currentSession?.title || t("agent.title")}
          </span>
        </Row>
        <ButtonGroup gap={1} className="button-group">
          <IconButton
            label={t("agent.newChat")}
            disabled={locked || readOnly}
            onClick={() => void agent.newSession()}
          >
            <Plus size={15} aria-hidden />
          </IconButton>
          <IconButton
            label={t("agent.history")}
            disabled={locked || readOnly}
            onClick={() => setHistoryOpen(true)}
          >
            <History size={15} aria-hidden />
          </IconButton>
          <IconButton
            label={t("agent.settings")}
            disabled={locked || readOnly}
            onClick={onSettings}
          >
            <Settings2 size={15} aria-hidden />
          </IconButton>
          <IconButton label={t("agent.close")} onClick={onClose}>
            <X size={16} aria-hidden />
          </IconButton>
        </ButtonGroup>
      </Row>
      <Row gap={2} align="center" justify="between" className="agent-run-status shrink-0 pr-[10px]">
        <output className="agent-state py-space-2 px-space-4 text-accent" aria-live="polite">
          {agent.phase === "ready"
            ? t(`agent.${agent.snapshot?.status ?? "idle"}`)
            : t(`agent.${agent.phase}`)}
        </output>
        {Boolean(agent.error) && (
          <Button onClick={() => void agent.retry()}>{t("agent.retry")}</Button>
        )}
        {canCancel && (
          <Button onClick={() => void agent.cancel()} disabled={agent.cancelling}>
            <Square size={13} aria-hidden />
            {t(agent.cancelling ? "agent.cancelling" : "agent.cancel")}
          </Button>
        )}
      </Row>
      {locked && (
        <p className="agent-lock-notice m-0 text-muted text-label [padding:0_12px_8px]">
          {t("agent.lockedNotice")}
        </p>
      )}
      {settings.connection?.configured === false && (
        <Row gap={2} justify="between" className="px-space-4 pb-space-3">
          <span className="text-muted text-label">{t("agent.notConfigured")}</span>
          <Button disabled={locked || readOnly} onClick={onSettings}>
            {t("agent.settings")}
          </Button>
        </Row>
      )}
      {/* The conversation needs keyboard focus for scrolling while editing is locked. */}
      {/* oxlint-disable jsx-a11y/no-noninteractive-tabindex */}
      <div
        ref={log}
        className="agent-conversation flex-1 [min-height:70px] overflow-auto p-space-4 [overscroll-behavior:contain] bg-background [&:focus-visible]:[outline:2px_solid_var(--accent)] [&:focus-visible]:[outline-offset:-2px]"
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
        {!messages.length && (
          <p className="agent-empty m-0 text-muted text-label">{t("agent.empty")}</p>
        )}
        {messages.map((message) => (
          <article
            className={`agent-message mb-[14px] ${message.role === "tool" ? "border-l-2 border-line pl-space-3 [&_.agent-message-content]:text-label" : ""}`}
            key={message.id}
          >
            <Row
              gap={2}
              align="center"
              wrap
              className="agent-message-heading text-caption text-muted [&_strong]:text-foreground"
            >
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
                <span className={message.success ? "" : "agent-failure text-danger"}>
                  {t(message.success ? "agent.toolSucceeded" : "agent.toolFailed")}
                </span>
              )}
            </Row>
            <div className="agent-message-content whitespace-pre-wrap [overflow-wrap:anywhere] mt-space-1 select-text">
              {message.role === "assistant" ? (
                <AgentMarkdown
                  content={message.content}
                  streaming={agent.snapshot?.status === "running" && last?.id === message.id}
                />
              ) : (
                messageContent(message)
              )}
            </div>
            <Row gap={2} align="stretch" wrap className="agent-message-images [&:empty]:hidden">
              {message.assetIds.map((id) => (
                <AgentImage key={id} id={id} />
              ))}
            </Row>
          </article>
        ))}
      </div>
      {/* oxlint-enable jsx-a11y/no-noninteractive-tabindex */}
      <Row
        gap={2}
        align="center"
        justify="between"
        wrap
        className="agent-conversation-actions py-space-2 px-[10px] [border-top:1px_solid_var(--line-subtle)] [&_button]:text-label"
      >
        <Button
          disabled={locked || readOnly || !agent.undoAvailable}
          onClick={() => void agent.undo()}
          title={t("agent.undoHelp")}
        >
          <Undo2 size={14} aria-hidden />
          {t("agent.undo")}
        </Button>
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
      </Row>
      <AgentApprovalCard agent={agent} readOnly={readOnly} />
      <AgentComposer
        key={agent.snapshot?.sessionId ?? "loading"}
        agent={agent}
        disabled={locked || readOnly}
      />
      {historyOpen && (
        <Modal open title={t("agent.history")} onClose={() => setHistoryOpen(false)}>
          <Row gap={2} className="mb-space-3">
            <span className="text-muted text-label">{t("agent.historyHelp")}</span>
          </Row>
          <Col gap={0} className="max-h-[60vh] overflow-auto">
            {agent.sessionsLoading ? (
              <p>{t("agent.loadingSettings")}</p>
            ) : agent.sessionError ? (
              <Row gap={2}>
                <span className="text-danger">{errorMessage(agent.sessionError)}</span>
                <Button onClick={() => void agent.retrySessions()}>{t("app.reload")}</Button>
              </Row>
            ) : (
              agent.sessions.map((session) => (
                <Row key={session.id} gap={2} className="py-space-2 border-b border-line-subtle">
                  <Button
                    className="flex-1 min-w-0 justify-start text-left aria-current:bg-accent-soft aria-current:text-accent"
                    disabled={locked || readOnly}
                    aria-current={session.id === agent.snapshot?.sessionId ? "true" : undefined}
                    onClick={() => {
                      if (session.id !== agent.snapshot?.sessionId)
                        void agent.selectSession(session.id);
                      setHistoryOpen(false);
                    }}
                  >
                    <span className="truncate">{session.title || t("agent.newChat")}</span>
                    <time
                      className="ml-auto text-caption text-muted"
                      dateTime={new Date(Number(session.createdAt)).toISOString()}
                    >
                      {new Date(Number(session.createdAt)).toLocaleDateString()}
                    </time>
                  </Button>
                  <IconButton
                    label={t("agent.deleteChat")}
                    disabled={locked || readOnly}
                    onClick={() => setDeleteId(session.id)}
                  >
                    <Trash2 size={14} aria-hidden />
                  </IconButton>
                </Row>
              ))
            )}
          </Col>
        </Modal>
      )}
      {deleteId && (
        <Modal
          open
          title={t("agent.deleteChat")}
          onClose={() => {
            if (!agent.sessionBusy) setDeleteId(null);
          }}
        >
          <p>{t("agent.deleteChatHelp")}</p>
          <Row gap={3} justify="end">
            <Button disabled={agent.sessionBusy} onClick={() => setDeleteId(null)}>
              {t("app.cancel")}
            </Button>
            <Button
              className="text-danger"
              disabled={locked || readOnly}
              onClick={() => {
                void agent.deleteSession(deleteId);
                setDeleteId(null);
              }}
            >
              {t("agent.deleteChat")}
            </Button>
          </Row>
        </Modal>
      )}
    </Col>
  );
}
