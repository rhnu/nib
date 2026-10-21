import { useEffect, useState } from "react";
import { ArrowLeft, FileText, Link2, Plus, Search } from "lucide-react";
import type { Resource, ResourceKind, ResourceSummary } from "./bindings/workbench";
import { api, errorMessage } from "./workbench-api";
import {
  CompositionEditor,
  emptyComposition,
  emptySettings,
  SettingsEditor,
} from "./composition-editor";
import { ActionsMenu, Modal } from "./ui";

export function ResourceLibrary({
  open,
  onClose,
  resources,
  models,
  onChanged,
  onInsert,
  target,
  onDirtyChange,
  notice,
}: {
  open: boolean;
  onClose: () => void;
  resources: Map<string, Resource>;
  models: string[];
  onChanged: () => Promise<void>;
  onInsert: (resource: ResourceSummary) => void;
  target: "positive" | "negative" | "preset";
  onDirtyChange: (dirty: boolean) => void;
  notice: string;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ResourceKind | "">("");
  const [items, setItems] = useState<ResourceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [queryError, setQueryError] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [editor, setEditor] = useState<Resource | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; action: () => void } | null>(null);
  useEffect(() => {
    onDirtyChange(dirty || busy);
  }, [dirty, busy, onDirtyChange]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void api.search({ text: query, kind: kind || null }).then(
        (found) => {
          if (active) {
            setItems(found);
            setQueryError("");
            setLoading(false);
          }
        },
        (cause: unknown) => {
          if (active) {
            setQueryError(errorMessage(cause));
            setLoading(false);
          }
        },
      );
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, query, kind, epoch]);
  const leave = (action: () => void) => {
    if (busy) return;
    if (dirty) setConfirm({ title: "放弃资源中未保存的修改？", action });
    else action();
  };
  const change = (resource: Resource) => {
    setEditor(resource);
    setDirty(true);
  };
  const refresh = async () => {
    await onChanged();
    setEpoch((value) => value + 1);
  };
  const create = (nextKind: ResourceKind) =>
    leave(() => {
      setEditor({
        id: crypto.randomUUID(),
        revision: 0,
        name: "",
        content:
          nextKind === "chunk"
            ? { kind: "chunk", text: "" }
            : { kind: "preset", composition: emptyComposition(), defaults: emptySettings() },
      });
      setDirty(false);
      setError("");
    });
  const select = (id: string) =>
    leave(() => {
      setBusy(true);
      void api
        .resource(id)
        .then(
          (resource) => {
            setEditor(resource);
            setDirty(false);
            setError("");
          },
          (cause: unknown) => setError(errorMessage(cause)),
        )
        .finally(() => setBusy(false));
    });
  const save = async () => {
    if (!editor || busy) return;
    if (!editor.name.trim()) {
      setError("请填写资源名称。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await api.saveResource({ ...editor, name: editor.name.trim() });
      setEditor(saved);
      setDirty(false);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const remove = () => {
    if (!editor) return;
    setConfirm({
      title: `删除“${editor.name}”？已有引用会保留并显示资源缺失。`,
      action: () => {
        setBusy(true);
        void api
          .deleteResource(editor.id, editor.revision)
          .then(async () => {
            setEditor(null);
            setDirty(false);
            await refresh();
          })
          .catch((cause: unknown) => setError(errorMessage(cause)))
          .finally(() => setBusy(false));
      },
    });
  };
  return (
    <>
      <Modal
        open={open}
        onClose={() =>
          leave(() => {
            setEditor(null);
            setDirty(false);
            onClose();
          })
        }
        title="资源库"
        wide
      >
        <div className="library-toolbar">
          <div className="search-field">
            <Search size={15} />
            <input
              aria-label="搜索资源"
              placeholder="搜索资源名称…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            aria-label="资源类型"
            value={kind}
            onChange={(event) => setKind(event.target.value as ResourceKind | "")}
          >
            <option value="">全部资源</option>
            <option value="chunk">Chunk</option>
            <option value="preset">Preset</option>
          </select>
          <ActionsMenu
            label="新建资源"
            items={[
              { label: "新建 Chunk", action: () => create("chunk") },
              { label: "新建 Preset", action: () => create("preset") },
            ]}
          >
            <Plus size={14} />
            新建
          </ActionsMenu>
        </div>
        {notice && (
          <div className="error-banner" role="alert">
            {notice}
          </div>
        )}
        {(error || queryError) && (
          <div className="error-banner" role="alert">
            {error || queryError}
            {queryError && <button onClick={() => setEpoch((value) => value + 1)}>重试查询</button>}
            {error && <button onClick={() => setError("")}>关闭提示</button>}
          </div>
        )}
        <div className={`library-body ${editor ? "has-editor" : ""}`}>
          <div className="resource-list" aria-busy={loading}>
            {loading ? (
              <p className="empty-note">正在查询…</p>
            ) : queryError ? (
              <p className="empty-note">资源查询未完成，请重试。</p>
            ) : items.length === 0 ? (
              <p className="empty-note">
                {query || kind
                  ? "没有匹配的资源。"
                  : "资源库还是空的。通过右上角菜单创建 Chunk 或 Preset。"}
              </p>
            ) : (
              items.map((item) => (
                <div
                  className={`resource-row ${editor?.id === item.id ? "selected" : ""}`}
                  key={item.id}
                >
                  <button className="resource-select" onClick={() => select(item.id)}>
                    {item.kind === "chunk" ? <Link2 size={17} /> : <FileText size={17} />}
                    <span>
                      {item.name}
                      <small>
                        {item.kind === "chunk" ? "Chunk · 提示词片段" : "Preset · 创作配方"}
                      </small>
                    </span>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`添加 ${item.name}`}
                    title={
                      item.kind === "preset"
                        ? "添加到应用的 Preset"
                        : `添加到${target === "negative" ? "负面" : "基础"}提示`
                    }
                    onClick={() => onInsert(item)}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
          {editor && (
            <section className="resource-editor">
              <header className="resource-editor-heading">
                <button
                  className="quiet"
                  onClick={() =>
                    leave(() => {
                      setEditor(null);
                      setDirty(false);
                    })
                  }
                >
                  <ArrowLeft size={14} />
                  列表
                </button>
                <span className="tag">{editor.content.kind === "chunk" ? "Chunk" : "Preset"}</span>
                <span className="spacer" />
                {editor.revision > 0 && (
                  <ActionsMenu
                    label="资源管理"
                    items={[{ label: "删除资源", danger: true, action: remove, disabled: busy }]}
                  />
                )}
              </header>
              <fieldset disabled={busy}>
                <label className="field">
                  <span>资源名称</span>
                  <input
                    value={editor.name}
                    placeholder="为资源命名"
                    onChange={(event) => change({ ...editor, name: event.target.value })}
                  />
                </label>
                {editor.content.kind === "chunk" ? (
                  <label className="field resource-text">
                    <span>提示词内容</span>
                    <textarea
                      spellCheck={false}
                      value={editor.content.text}
                      placeholder="输入可复用的提示词…"
                      onChange={(event) =>
                        change({ ...editor, content: { kind: "chunk", text: event.target.value } })
                      }
                    />
                  </label>
                ) : (
                  <>
                    <CompositionEditor
                      compact
                      value={editor.content.composition}
                      resources={resources}
                      onChange={(composition) => {
                        if (editor.content.kind === "preset")
                          change({ ...editor, content: { ...editor.content, composition } });
                      }}
                      expandChunk={async (node) => {
                        try {
                          return await api.expandChunk(node);
                        } catch (cause) {
                          setError(errorMessage(cause));
                          return node;
                        }
                      }}
                    />
                    <details>
                      <summary>配方默认设置</summary>
                      <p className="help-note">仅声明这个配方负责的设置，留空则继续继承。</p>
                      <SettingsEditor
                        value={editor.content.defaults}
                        models={models}
                        onChange={(defaults) => {
                          if (editor.content.kind === "preset")
                            change({ ...editor, content: { ...editor.content, defaults } });
                        }}
                      />
                    </details>
                  </>
                )}
              </fieldset>
              <footer className="resource-editor-footer">
                <span className="muted">
                  {dirty ? "尚未保存" : editor.revision ? `版本 ${editor.revision}` : "新资源"}
                </span>
                <button
                  className="primary"
                  disabled={busy || (!dirty && editor.revision > 0)}
                  onClick={() => void save()}
                >
                  {busy ? "保存中…" : "保存资源"}
                </button>
              </footer>
            </section>
          )}
        </div>
        <footer className="library-footer">
          <span>
            添加 Chunk → {target === "negative" ? "负面提示" : "基础提示"} · Preset → 配方列表
          </span>
        </footer>
      </Modal>
      <Modal open={confirm !== null} onClose={() => setConfirm(null)} title="确认操作">
        <p className="confirm-copy">{confirm?.title}</p>
        <div className="dialog-actions">
          <button onClick={() => setConfirm(null)}>取消</button>
          <button
            className="danger-button"
            onClick={() => {
              const action = confirm?.action;
              setConfirm(null);
              action?.();
            }}
          >
            确认
          </button>
        </div>
      </Modal>
    </>
  );
}
