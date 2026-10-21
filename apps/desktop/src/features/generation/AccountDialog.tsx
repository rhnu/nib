import { useEffect, useRef, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { Button, Field, Modal, Notice } from "../../shared/ui";
import { errorMessage } from "../../shared/host/error";
import { generationApi } from "./api";
import { useGeneration } from "./GenerationProvider";

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const { account, accountChanged } = useGeneration();
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function save() {
    if (!key.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const status = await generationApi.saveKey(key.trim());
      accountChanged(status);
      if (!active.current) return;
      setKey("");
      onClose();
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      if (active.current) setPending(false);
    }
  }

  async function remove() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      accountChanged(await generationApi.deleteKey());
      if (active.current) {
        setKey("");
        onClose();
      }
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      if (active.current) setPending(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        setKey("");
        onClose();
      }}
      title="NovelAI 账户凭据"
    >
      <form
        className="generation-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="generation-muted">
          API Key 由系统凭据后端保存。输入内容仅用于本次保存，不保留在界面中。
        </p>
        <p>
          {account?.configured
            ? "已配置 API Key；可以替换或移除。"
            : "配置 API Key 后才能提交生成。"}
        </p>
        <Field label="NovelAI API Key">
          <input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={pending}
            required
            aria-describedby="generation-key-help"
          />
        </Field>
        <p id="generation-key-help" className="generation-muted">
          保存凭据不会发起生成，也不会验证远程账户余额。
        </p>
        {error && <Notice>{error}</Notice>}
        <footer className="generation-dialog-actions">
          {account?.configured && (
            <Button className="danger" disabled={pending} onClick={() => void remove()}>
              <Trash2 size={14} />
              移除凭据
            </Button>
          )}
          <span className="generation-spacer" />
          <Button
            onClick={() => {
              setKey("");
              onClose();
            }}
          >
            取消
          </Button>
          <Button type="submit" className="primary" disabled={!key.trim() || pending}>
            <KeyRound size={14} />
            {pending ? "正在保存…" : "保存凭据"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
