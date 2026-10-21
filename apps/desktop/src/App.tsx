import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CircleAlert,
  Library,
  LoaderCircle,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ScanText,
  Sun,
} from "lucide-react";
import type {
  Draft,
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
import { IconButton } from "./ui";

/** The workspace owns live draft state; reusable resources are fetched through the host. */
export default function App() {
  const [writer] = useState(() => new DraftWriter<Draft>(api.saveDraft));
  const written = useSyncExternalStore(writer.subscribe, writer.getSnapshot);
  const draft = written.value;
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
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
          setError(`窗口未关闭，当前创作仍保留在编辑器中：${errorMessage(cause)}`);
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
                  "当前在独立浏览器中运行，未连接桌面宿主。资源与当前创作需要通过 nib 桌面应用打开。"}
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
        <span className="editor-label">当前创作</span>
        <span className="spacer" />
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
                    if (current)
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
    </div>
  );
}
