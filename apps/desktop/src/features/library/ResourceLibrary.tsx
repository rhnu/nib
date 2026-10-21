import { Plus, Search } from "lucide-react";
import type { Resource, ResourceKind, ResourceSummary } from "../../bindings/workbench";
import { ActionsMenu, Button, HelpMarker, Modal } from "../../shared/ui";
import { ResourceEditor } from "./ResourceEditor";
import { ResourceList } from "./ResourceList";
import { useResourceSearch } from "./useResourceSearch";
import { useResourceEditor } from "./useResourceEditor";
export type InsertTarget = "positive" | "negative" | "preset";
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
  target: InsertTarget;
  onDirtyChange: (dirty: boolean) => void;
  notice: string;
}) {
  const { query, setQuery, kind, setKind, items, loading, queryError, refreshSearch } =
    useResourceSearch(open);
  const {
    editor,
    dirty,
    busy,
    confirm,
    setConfirm,
    error,
    setError,
    change,
    leave,
    create,
    select,
    save,
    remove,
    dismiss,
  } = useResourceEditor(onChanged, refreshSearch, onDirtyChange);
  return (
    <>
      <Modal
        open={open}
        onClose={() =>
          leave(() => {
            dismiss();
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
          <HelpMarker label="资源使用说明">
            Chunk 添加到当前提示词作用域，Preset
            添加到配方列表。编辑资源原件后需保存；在创作中修改链接只影响本次实例。
          </HelpMarker>
        </div>
        {notice && (
          <div className="error-banner" role="alert">
            {notice}
          </div>
        )}
        {(error || queryError) && (
          <div className="error-banner" role="alert">
            {error || queryError}
            {queryError && <Button onClick={() => refreshSearch()}>重试查询</Button>}
            {error && <Button onClick={() => setError("")}>关闭提示</Button>}
          </div>
        )}
        <div className={`library-body ${editor ? "has-editor" : ""}`}>
          <ResourceList
            loading={loading}
            queryError={queryError}
            items={items}
            filtered={Boolean(query || kind)}
            selectedId={editor?.id}
            onSelect={select}
            onInsert={onInsert}
            target={target}
          />
          {editor && (
            <ResourceEditor
              editor={editor}
              dirty={dirty}
              busy={busy}
              models={models}
              resources={resources}
              change={change}
              leave={leave}
              dismiss={dismiss}
              remove={remove}
              save={save}
              setError={setError}
            />
          )}
        </div>
      </Modal>
      <Modal open={confirm !== null} onClose={() => setConfirm(null)} title="确认操作">
        <p className="confirm-copy">{confirm?.title}</p>
        <div className="dialog-actions">
          <Button onClick={() => setConfirm(null)}>取消</Button>
          <Button
            className="danger-button"
            onClick={() => {
              const action = confirm?.action;
              setConfirm(null);
              action?.();
            }}
          >
            确认
          </Button>
        </div>
      </Modal>
    </>
  );
}
