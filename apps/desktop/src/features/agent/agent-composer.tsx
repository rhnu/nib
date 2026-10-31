import { useLayoutEffect, useRef, useState } from "react";
import { ClipboardPaste, Send, X } from "lucide-react";
import { Button, Field, FilePicker, IconButton } from "@/shared/ui";
import { t } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { mediaApi } from "@/features/media/api";
import { importAndCommitImage } from "@/features/media/image-import";
import { AgentImage } from "./agent-image";
import type { AgentController } from "./use-agent";

/** Composer attachments are ordinary media assets; a successful send transfers their references to chat. */
export function AgentComposer({ agent, disabled }: { agent: AgentController; disabled: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
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
      setError(new Error(t("agent.imageLimit")));
      return;
    }
    latest.current.busy = true;
    setBusy(true);
    setError(null);
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
      if (latest.current.active) setError(cause);
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
      if (latest.current.active) setError(cause);
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
        setError(null);
      }
    } finally {
      latest.current.busy = false;
      if (latest.current.active) setBusy(false);
    }
  };

  return (
    <form
      className="agent-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className="agent-message-images">
        {assetIds.map((id) => (
          <div className="agent-attachment" key={id}>
            <AgentImage id={id} />
            <div className="agent-image-actions">
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
            </div>
          </div>
        ))}
      </div>
      <Field label={t("agent.prompt")}>
        <textarea
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
      {error !== null && (
        <p className="agent-failure" role="alert">
          {errorMessage(error)}
        </p>
      )}
      {assetIds.length > 0 && <p className="agent-help">{t("agent.imageHelp")}</p>}
      <div className="agent-composer-actions">
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
          className="primary"
          type="submit"
          disabled={
            disabled ||
            busy ||
            agent.connectionBusy ||
            (!prompt.trim() && !assetIds.length) ||
            !agent.connection?.configured ||
            !agent.snapshot
          }
        >
          <Send size={14} aria-hidden />
          {t(busy ? "agent.preparing" : "agent.send")}
        </Button>
      </div>
    </form>
  );
}
