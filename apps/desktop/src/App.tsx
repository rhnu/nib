import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Check,
  CircleAlert,
  FileText,
  Library,
  LoaderCircle,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Save,
  ScanText,
  Sun,
} from "lucide-react";
import type {
  Draft,
  DraftSummary,
  Resource,
  ResourceSummary,
  ResolvedDraft,
  WorkspaceSnapshot,
} from "./bindings/workbench";
import { api, errorMessage } from "./workbench-api";
import { DraftWriter } from "./draft-writer";
import { CompositionEditor, moveItem, SettingsEditor } from "./composition-editor";
import { PresetEditor } from "./preset-editor";
import { ResourceLibrary } from "./resource-library";
import { ResolutionInspector } from "./resolution-inspector";
import { IconButton, Modal } from "./ui";

/** The workspace owns live draft state; reusable resources are fetched through the host. */
export default function App() {
  const [writer] = useState(() => new DraftWriter<Draft>(api.saveDraft));
  const written = useSyncExternalStore(writer.subscribe, writer.getSnapshot);
  const draft = written.value;
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [resources, setResources] = useState(new Map<string, Resource>());
  const resourceEpoch = useRef(0);
  const [loading, setLoading] = useState(isTauri);
  const [attempt, setAttempt] = useState(0);
  const [startupError, setStartupError] = useState("");
  const [error, setError] = useState("");
  const [resolved, setResolved] = useState<ResolvedDraft | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [library, setLibrary] = useState(false);
  const [insertTarget, setInsertTarget] = useState<"positive" | "negative" | "preset">("positive");
  const [resourceDirty, setResourceDirty] = useState(false);
  const resourceDirtyRef = useRef(false);
  useLayoutEffect(() => {
    resourceDirtyRef.current = resourceDirty;
  }, [resourceDirty]);
  const [inspector, setInspector] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [newDraft, setNewDraft] = useState(false);
  const [newName, setNewName] = useState("");
  const [theme, setTheme] = useState(() =>
    localStorage.getItem("nib-theme") === "light" ? "light" : "dark",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("nib-theme", theme);
  }, [theme]);
  useEffect(() => {
    let active = true;
    if (!isTauri()) {
      return;
    }
    void api
      .workspace()
      .then(async (snapshot) => {
        if (!active) return;
        setWorkspace(snapshot);
        setDrafts(snapshot.drafts);
        writer.replace(snapshot.draft);
        const fetched = await Promise.all(snapshot.resources.map((item) => api.resource(item.id)));
        if (active) {
          setResources(new Map(fetched.map((item) => [item.id, item])));
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setStartupError(errorMessage(cause));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [attempt, writer]);
  useEffect(() => {
    if (!written.dirty || written.error) return;
    const timer = setTimeout(() => {
      void writer.flush().catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, writer, written.dirty, written.error]);
  useEffect(
    () =>
      writer.subscribe(() => {
        const current = writer.getSnapshot();
        if (!current.value || current.dirty) return;
        const summary = {
          id: current.value.id,
          revision: current.value.revision,
          name: current.value.name,
        };
        setDrafts((previous) =>
          previous.some((item) => item.id === summary.id)
            ? previous.map((item) => (item.id === summary.id ? summary : item))
            : [...previous, summary],
        );
      }),
    [writer],
  );
  useEffect(() => {
    if (!draft) return;
    let active = true;
    const timer = setTimeout(() => {
      setResolving(true);
      void api.resolve(draft).then(
        (value) => {
          if (active) {
            setResolved(value);
            setResolveError("");
            setResolving(false);
          }
        },
        (cause: unknown) => {
          if (active) {
            setResolved(null);
            setResolveError(errorMessage(cause));
            setResolving(false);
          }
        },
      );
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [draft, resources]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (writer.getSnapshot().dirty || resourceDirtyRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    if (!isTauri()) return () => window.removeEventListener("beforeunload", beforeUnload);
    let stopped = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (resourceDirtyRef.current) {
          setError("资源中有未保存的修改。请先保存资源，再关闭窗口。");
          setLibrary(true);
          return;
        }
        setLibrary(false);
        try {
          await writer.flush();
          await getCurrentWindow().destroy();
        } catch (cause) {
          setError(`窗口未关闭，草稿仍保留在编辑器中：${errorMessage(cause)}`);
        }
      })
      .then(
        (off) => {
          if (stopped) off();
          else unlisten = off;
        },
        (cause: unknown) => setError(errorMessage(cause)),
      );
    return () => {
      stopped = true;
      unlisten?.();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [writer]);
  const edit = (value: Draft) => writer.edit(value);
  const openLibrary = (target: "positive" | "negative" | "preset") => {
    setInsertTarget(target);
    setLibrary(true);
  };
  const refreshResources = async () => {
    const epoch = ++resourceEpoch.current;
    const summaries = await api.search({ text: "", kind: null });
    const fetched = await Promise.all(summaries.map((summary) => api.resource(summary.id)));
    if (epoch === resourceEpoch.current)
      setResources(new Map(fetched.map((item) => [item.id, item])));
  };
  const insert = (resource: ResourceSummary) => {
    const current = writer.getSnapshot().value;
    if (!current) return;
    if (resource.kind === "preset")
      edit({
        ...current,
        presets: [
          ...current.presets,
          {
            id: crypto.randomUUID(),
            enabled: true,
            binding: { kind: "linked", resourceId: resource.id, overrides: [] },
          },
        ],
      });
    else {
      const scope = insertTarget === "negative" ? "negative" : "positive";
      edit({
        ...current,
        composition: {
          ...current.composition,
          [scope]: [
            ...current.composition[scope],
            {
              kind: "chunk",
              id: crypto.randomUUID(),
              resourceId: resource.id,
              enabled: true,
              overrideText: null,
            },
          ],
        },
      });
    }
    if (!resources.has(resource.id))
      void refreshResources().catch((cause: unknown) => setError(errorMessage(cause)));
  };
  const switchDraft = async (id: string) => {
    if (switching || id === draft?.id) return;
    setSwitching(true);
    setError("");
    try {
      await writer.flush();
      const next = await api.draft(id);
      writer.replace(next);
      setResolved(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSwitching(false);
    }
  };
  const createDraft = async () => {
    if (!newName.trim() || switching) return;
    setSwitching(true);
    setError("");
    try {
      await writer.flush();
      const next = await api.createDraft(newName.trim());
      writer.replace(next);
      setResolved(null);
      setNewDraft(false);
      setNewName("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSwitching(false);
    }
  };
  if (loading || startupError || !workspace || !draft)
    return (
      <main className="startup">
        <section className="startup-panel">
          <div className="brand-mark">n</div>
          <h1>nib</h1>
          <p className="muted">本地创作工作台</p>
          {loading ? (
            <p className="startup-message">
              <LoaderCircle className="spin" size={17} />
              正在打开工作区…
            </p>
          ) : (
            <>
              <p className="startup-message">
                {startupError ||
                  "当前在独立浏览器中运行，未连接桌面宿主。资源与草稿需要通过 nib 桌面应用打开。"}
              </p>
              <button
                onClick={() => {
                  setLoading(isTauri());
                  setStartupError("");
                  setAttempt((value) => value + 1);
                }}
              >
                重新连接
              </button>
              <details>
                <summary>如何打开工作台</summary>
                <p>
                  在项目目录运行 <code>pnpm dev</code> 启动桌面应用。<code>pnpm dev:web</code>{" "}
                  仅预览前端，无法访问本地资源。
                </p>
              </details>
            </>
          )}
        </section>
      </main>
    );
  return (
    <div className="workbench">
      <header className="app-toolbar">
        <div className="app-brand">
          nib
          <span className="brand-divider" />
        </div>
        <div className="draft-picker">
          <FileText size={15} />
          <select
            aria-label="当前草稿"
            disabled={switching}
            value={draft.id}
            onChange={(event) => void switchDraft(event.target.value)}
          >
            {drafts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id === draft.id ? draft.name : item.name}
              </option>
            ))}
          </select>
          <IconButton
            label="新建草稿"
            onClick={() => {
              setError("");
              setNewDraft(true);
            }}
          >
            <Plus size={16} />
          </IconButton>
        </div>
        <span className="spacer" />
        <output className={`save-status ${written.error ? "danger" : ""}`}>
          {written.error ? (
            <CircleAlert size={14} />
          ) : written.saving ? (
            <LoaderCircle size={14} className="spin" />
          ) : !written.dirty ? (
            <Check size={14} />
          ) : (
            <span className="unsaved-dot" />
          )}
          {written.error
            ? "保存失败"
            : written.saving
              ? "正在保存"
              : written.dirty
                ? "未保存"
                : "已保存"}
        </output>
        <button
          disabled={written.saving || !written.dirty}
          onClick={() => void writer.flush().catch(() => {})}
        >
          <Save size={15} />
          <span className="button-copy">保存</span>
        </button>
        <IconButton
          label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
      </header>
      {Boolean(error || written.error) && (
        <div role="alert" className="error-banner">
          <CircleAlert size={16} />
          <span>{error || errorMessage(written.error)}</span>
          {Boolean(written.error) && (
            <button onClick={() => void writer.flush().catch(() => {})}>重试保存</button>
          )}
          {error && (
            <button className="quiet" onClick={() => setError("")}>
              关闭提示
            </button>
          )}
        </div>
      )}
      <div className={`workspace-body ${contextOpen ? "" : "context-hidden"}`}>
        <aside className="context-rail">
          <section className="draft-context">
            <div className="eyebrow">当前创作</div>
            <label className="field draft-title">
              <span>草稿名称</span>
              <input
                value={draft.name}
                aria-label="草稿名称"
                onChange={(event) => edit({ ...draft, name: event.target.value })}
              />
            </label>
          </section>
          <section className="preset-context">
            <header className="section-heading">
              <h2>
                应用的 Preset<span className="count">{draft.presets.length}</span>
              </h2>
              <IconButton label="添加 Preset" onClick={() => openLibrary("preset")}>
                <Plus size={16} />
              </IconButton>
            </header>
            {draft.presets.length === 0 ? (
              <p className="empty-note">暂无配方。添加 Preset 可复用提示词与默认设置。</p>
            ) : (
              draft.presets.map((instance, index) => (
                <PresetEditor
                  key={instance.id}
                  instance={instance}
                  resources={resources}
                  models={workspace.models}
                  onChange={(value) => {
                    const current = writer.getSnapshot().value;
                    if (current?.id === draft.id)
                      edit({
                        ...current,
                        presets: current.presets.map((item) =>
                          item.id === instance.id ? value : item,
                        ),
                      });
                  }}
                  onRemove={() =>
                    edit({
                      ...draft,
                      presets: draft.presets.filter((item) => item.id !== instance.id),
                    })
                  }
                  up={() => edit({ ...draft, presets: moveItem(draft.presets, index, -1) })}
                  down={() => edit({ ...draft, presets: moveItem(draft.presets, index, 1) })}
                  canUp={index > 0}
                  canDown={index < draft.presets.length - 1}
                  onError={setError}
                />
              ))
            )}
          </section>
          <section className="settings-context">
            <header className="section-heading">
              <h2>生成设置</h2>
            </header>
            <SettingsEditor
              compact
              value={draft.settings}
              models={workspace.models}
              resolved={resolved?.settings}
              onChange={(settings) => edit({ ...draft, settings })}
            />
            <p className="help-note">留空继承配方或 SDK 默认。解析面板中可查看生效值与来源。</p>
          </section>
        </aside>
        <main className="main-workspace">
          <header className="editor-toolbar">
            <div className="button-group">
              <IconButton
                label={contextOpen ? "收起上下文" : "显示上下文"}
                onClick={() => setContextOpen(!contextOpen)}
              >
                {contextOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
              </IconButton>
              <span className="editor-label">提示词组合</span>
            </div>
            <div className="button-group">
              <button onClick={() => openLibrary("positive")}>
                <Library size={15} />
                资源库
              </button>
              <button
                className={inspector ? "active-button" : ""}
                aria-pressed={inspector}
                onClick={() => setInspector(!inspector)}
              >
                <ScanText size={15} />
                解析
              </button>
            </div>
          </header>
          <div className={`editing-area ${inspector ? "with-inspector" : ""}`}>
            <div className="editor-scroll">
              <CompositionEditor
                value={draft.composition}
                resources={resources}
                onChange={(composition) => edit({ ...draft, composition })}
                addChunk={openLibrary}
                expandChunk={async (node) => {
                  try {
                    return await api.expandChunk(node);
                  } catch (cause) {
                    setError(errorMessage(cause));
                    return node;
                  }
                }}
              />
            </div>
            {inspector && (
              <ResolutionInspector
                resolved={resolved}
                pending={resolving}
                error={resolveError}
                draft={draft}
                resources={resources}
              />
            )}
          </div>
          <footer className="workspace-status">
            <span>
              {resolved?.issues.length
                ? `${resolved.issues.length} 项引用问题`
                : resolveError
                  ? "解析失败"
                  : resolving
                    ? "正在解析组合…"
                    : "本地工作区"}
            </span>
            <span>{workspace.info.version}</span>
          </footer>
        </main>
      </div>
      <ResourceLibrary
        open={library}
        onClose={() => setLibrary(false)}
        resources={resources}
        models={workspace.models}
        onChanged={refreshResources}
        onInsert={insert}
        target={insertTarget}
        onDirtyChange={setResourceDirty}
        notice={error || (written.error ? errorMessage(written.error) : "")}
      />
      <Modal
        open={newDraft}
        onClose={() => {
          if (!switching) setNewDraft(false);
        }}
        title="新建草稿"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createDraft();
          }}
        >
          <label className="field">
            <span>草稿名称</span>
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="为这次创作命名"
            />
          </label>
          {error && (
            <p className="inline-warning" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={() => setNewDraft(false)} disabled={switching}>
              取消
            </button>
            <button className="primary" disabled={!newName.trim() || switching}>
              {switching ? "创建中…" : "创建草稿"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
