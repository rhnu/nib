import {
  Button,
  Toolbar,
  Field,
  FilePicker,
  IconButton,
  Grid,
  Row,
  Textarea,
  notify,
  HelpMarker,
} from "@/shared/ui";

import { useLayoutEffect, useRef, useState } from "react";
import { ClipboardPaste, Send, X } from "lucide-react";

import { t } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { mediaApi } from "@/features/media/api";
import { importAndCommitImage } from "@/features/media/image-import";
import { AgentImage } from "./agent-image";
import type { AgentController } from "./use-agent";
import { useAgentSettings } from "./use-agent-settings";

/** Composer attachments are ordinary media assets; a successful send transfers their references to chat. */
export function AgentComposer({ agent, disabled }: { agent: AgentController; disabled: boolean }) {
  const settings = useAgentSettings();
  const [prompt, setPrompt] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reportError = (cause: unknown) =>
    notify(() => errorMessage(cause), "agent-composer-error", true);

  const latest = useRef({ active: true, disabled, busy: false, attachmentCount: 0 });
  useLayoutEffect(() => {
    latest.current.disabled = disabled;
  }, [disabled]);
  useLayoutEffect(() => {
    const state = latest.current;
    state.active = true;
    return () => {
      state.active = false;
    };
  }, []);

  const importFile = async (file: File) => {
    if (latest.current.busy || latest.current.disabled) return;
    if (latest.current.attachmentCount >= 4) {
      reportError(new Error(t("agent.imageLimit")));
      return;
    }
    latest.current.busy = true;
    setBusy(true);
    try {
      await importAndCommitImage({
        file,
        importImage: mediaApi.importImage,
        isCurrent: () => latest.current.active && !latest.current.disabled,
        commit: (asset) => {
          latest.current.attachmentCount++;
          setAssetIds((ids) => [...ids, asset.id]);
        },
      });
    } catch (cause) {
      if (latest.current.active) reportError(cause);
    } finally {
      latest.current.busy = false;
      if (latest.current.active) setBusy(false);
    }
  };

  const paste = async () => {
    try {
      const items = await navigator.clipboard.read();
      const item = items.find((item) => item.types.some((type) => type.startsWith("image/")));
      const type = item?.types.find((type) => type.startsWith("image/"));
      if (!item || !type) throw new Error(t("library.noClipboardImage"));
      const blob = await item.getType(type);
      if (latest.current.active) await importFile(new File([blob], "clipboard-image", { type }));
    } catch (cause) {
      if (latest.current.active) reportError(cause);
    }
  };

  const send = async () => {
    if (latest.current.busy || disabled || (!prompt.trim() && !assetIds.length)) return;
    latest.current.busy = true;
    setBusy(true);
    try {
      if (await agent.start(prompt.trim(), assetIds)) {
        setPrompt("");
        setAssetIds([]);
        latest.current.attachmentCount = 0;
      }
    } finally {
      latest.current.busy = false;
      if (latest.current.active) setBusy(false);
    }
  };

  return (
    <Grid
      align="stretch"
      gap={3}
      columns={1}
      as="form"
      className="agent-composer [padding:8px_12px_12px] [border-top:1px_solid_var(--line-subtle)] [max-height:45%] overflow-auto [&_textarea]:[min-height:80px] [&_textarea]:[max-height:200px] [&_textarea]:text-body [&_textarea]:[line-height:1.5]"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Row gap={2} align="stretch" wrap className="agent-message-images [&:empty]:hidden">
        {assetIds.map((id) => (
          <div className="agent-attachment relative" key={id}>
            <AgentImage id={id} />
            <Row
              gap={0}
              align="stretch"
              className="agent-image-actions absolute [right:2px] [top:2px] [border-radius:var(--radius-sm)] bg-panel"
            >
              <IconButton
                label={t("agent.removeImage")}
                disabled={disabled || busy}
                onClick={() => {
                  latest.current.attachmentCount--;
                  setAssetIds((ids) => ids.filter((value) => value !== id));
                }}
              >
                <X size={13} aria-hidden />
              </IconButton>
            </Row>
          </div>
        ))}
      </Row>
      <Field
        label={t("agent.prompt")}
        help={<HelpMarker label={t("agent.attachImage")}>{t("agent.imageHelp")}</HelpMarker>}
      >
        <Textarea
          autoComplete="off"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t("agent.promptPlaceholder")}
          disabled={disabled || busy}
          rows={3}
          onPaste={(event) => {
            const file = Array.from(event.clipboardData.files).find((file) =>
              file.type.startsWith("image/"),
            );
            if (file) {
              event.preventDefault();
              void importFile(file);
            }
          }}
        />
      </Field>
      <Toolbar gap={2} align="center" justify="end" wrap className="agent-composer-actions ">
        <FilePicker
          label={t("agent.attachImage")}
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          disabled={disabled || busy || assetIds.length >= 4}
          onChoose={(file) => void importFile(file)}
        />
        <IconButton
          label={t("agent.pasteImage")}
          disabled={disabled || busy || assetIds.length >= 4}
          onClick={() => void paste()}
        >
          <ClipboardPaste size={14} aria-hidden />
        </IconButton>
        <Button
          variant="primary"
          className="ml-auto"
          type="submit"
          disabled={
            disabled ||
            busy ||
            settings.connectionBusy ||
            (!prompt.trim() && !assetIds.length) ||
            !settings.connection?.configured ||
            !agent.snapshot
          }
        >
          <Send size={14} aria-hidden />
          {t(busy ? "agent.preparing" : "agent.send")}
        </Button>
      </Toolbar>
    </Grid>
  );
}
