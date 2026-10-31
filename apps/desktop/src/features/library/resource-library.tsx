import { t, useTranslation } from "@/shared/i18n";
import { useEffect } from "react";
import { errorMessage } from "@/shared/host/error";
import { resourceDependencies } from "./resource-dependencies";
import { Plus, Search } from "lucide-react";
import type { Resource, ResourceKind, ResourceSummary } from "@/bindings/workbench";
import { ActionsMenu, Button, Modal, Notice } from "@/shared/ui";
import { ResourceEditor } from "./resource-editor";
import { ResourceList } from "./resource-list";
import { useResourceSearch } from "./use-resource-search";
import { useResourceEditor } from "./use-resource-editor";

export type InsertTarget = "positive" | "negative" | "preset";

export function ResourceLibrary({
  open,
  resources,
  models,
  onChanged,
  onInsert,
  target,
  ensureResources,
  resourceVersion,
}: {
  open: boolean;
  resources: Map<string, Resource>;
  models: string[];
  onChanged: (id: string) => Promise<void>;
  ensureResources: (ids: string[]) => Promise<void>;
  resourceVersion: number;
  onInsert: (resource: ResourceSummary) => void;
  target: InsertTarget;
}) {
  useTranslation();

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
  } = useResourceEditor(onChanged, refreshSearch);
  const dependencyKey = JSON.stringify(editor ? resourceDependencies(editor) : []);
  useEffect(() => {
    void ensureResources(JSON.parse(dependencyKey) as string[]).catch((cause: unknown) =>
      setError(cause),
    );
  }, [dependencyKey, ensureResources, setError, resourceVersion]);
  return (
    <>
      <section className="library-page" hidden={!open} aria-label={t("library.title")}>
        <div className="library-toolbar">
          <div className="library-search-field">
            <Search size={15} />
            <input
              aria-label={t("library.searchResources")}
              placeholder={t("library.searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            aria-label={t("library.resourceType")}
            value={kind}
            onChange={(event) => setKind(event.target.value as ResourceKind | "")}
          >
            <option value="">{t("library.allResources")}</option>
            <option value="chunk">{t("library.chunk")}</option>
            <option value="preset">{t("library.preset")}</option>
          </select>
          <ActionsMenu
            label={t("library.createResource")}
            items={[
              { label: t("library.createChunk"), action: () => create("chunk") },
              { label: t("library.createPreset"), action: () => create("preset") },
            ]}
          >
            <Plus size={14} />
            {t("library.create")}
          </ActionsMenu>
        </div>
        {error && (
          <Notice
            actions={<Button onClick={() => setError("")}>{t("library.dismissNotice")}</Button>}
          >
            {error}
          </Notice>
        )}
        {queryError && (
          <Notice actions={<Button onClick={refreshSearch}>{t("library.retryQuery")}</Button>}>
            {queryError}
          </Notice>
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
      </section>
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t("library.confirmAction")}
      >
        <p className="confirm-copy">{confirm && errorMessage(confirm.title)}</p>
        <div className="dialog-actions">
          <Button onClick={() => setConfirm(null)}>{t("library.cancel")}</Button>
          <Button
            className="danger-button"
            onClick={() => {
              const action = confirm?.action;
              setConfirm(null);
              action?.();
            }}
          >
            {t("library.confirm")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
