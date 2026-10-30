import { useLayoutEffect, useRef, useState } from "react";
import type { MediaAsset, VibeDocumentInspection } from "@/bindings/media";
import type { ModelCapabilities, VibeReferenceInput } from "@/bindings/workbench";
import { ActionsMenu, Button, FilePicker, Modal, Notice } from "@/shared/ui";
import { ImagePickerDialog } from "@/features/media";
import { mediaApi } from "@/features/media/api";
import { useMediaQuery } from "@/features/media/use-media-query";
import { VibeAssetInformation } from "./vibe-asset-details";
import { downloadBytes, vibeMaterialName } from "./model";
import { useVibeAction } from "./use-vibe-action";
import "./vibes.css";

type DocumentSelection =
  | { entryIndex: number; kind: "image" }
  | { entryIndex: number; kind: "encoded"; modelKey: string; parameterKey: string };
export interface VibeMaterialDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (values: VibeReferenceInput[], mode: "append" | "replace") => void;
  capabilities: ModelCapabilities | null;
  initialAssetId?: string | null;
  single?: boolean;
}
export function VibeMaterialDialog({ open, ...props }: VibeMaterialDialogProps) {
  return open ? <Materials {...props} /> : null;
}

function Materials({
  onClose,
  onSelect,
  capabilities,
  initialAssetId,
  single = false,
}: Omit<VibeMaterialDialogProps, "open">) {
  const assets = useMediaQuery(["media", "assets"], "all", mediaApi.assets, 0);
  const [selectedId, setSelectedId] = useState<string | null>(initialAssetId ?? null);
  const [selection, setSelection] = useState<DocumentSelection[]>([]);
  const [bundleIds, setBundleIds] = useState<string[]>([]);
  const [imageAction, setImageAction] = useState<"document" | "embedded" | "read" | "embed" | null>(
    null,
  );
  const action = useVibeAction();
  const latest = useRef({ onSelect, onClose });
  useLayoutEffect(() => {
    Object.assign(latest.current, { onSelect, onClose });
  }, [onSelect, onClose]);
  const selected = assets.value?.find((asset) => asset.id === selectedId) ?? null;
  const document = useMediaQuery(
    ["media", "vibe-document", selected?.id],
    selected?.kind === "vibeDocument" ? selected.id : null,
    mediaApi.inspectVibeDocument,
  );
  const encoding = useMediaQuery(
    ["media", "vibe-inspection", selected?.id],
    selected?.kind === "vibe" ? selected.id : null,
    mediaApi.inspectVibeAsset,
  );
  const selectAsset = (id: string) => {
    setSelectedId(id);
    setSelection([]);
  };
  const retain = (asset: MediaAsset) => {
    selectAsset(asset.id);
    assets.retry();
  };
  const saveDocument = async (id: string, name: string, active: () => boolean) => {
    const inspection = await mediaApi.inspectVibeDocument(id);
    if (!active()) return;
    const bytes = await mediaApi.exportVibeDocument(id);
    if (active())
      downloadBytes(bytes, `${name}.${inspection.isBundle ? "naiv4vibeBundle" : "naiv4vibe"}`);
  };
  const choose = (mode: "append" | "replace") =>
    void action.run(async (active) => {
      if (!selected) return;
      const values: VibeReferenceInput[] = [];
      if (selected.kind === "vibeDocument") {
        for (const item of selection) {
          const asset =
            item.kind === "image"
              ? await mediaApi.importDocumentImage(selected.id, item.entryIndex)
              : await mediaApi.importDocumentEncoding(
                  selected.id,
                  item.entryIndex,
                  item.modelKey,
                  item.parameterKey,
                );
          if (!active()) return;
          values.push(await mediaApi.createVibeReference(asset.id));
          if (!active()) return;
        }
      } else {
        values.push(await mediaApi.createVibeReference(selected.id));
      }
      if (active() && values.length) {
        latest.current.onSelect(values, mode);
        latest.current.onClose();
      }
    });
  const file = async (file: File, kind: "document" | "encoded" = "document") =>
    action.run(async (active) => {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      if (!active()) return;
      const asset =
        kind === "encoded"
          ? await mediaApi.importVibe(bytes, file.name)
          : await mediaApi.importVibeDocument(bytes, file.name);
      if (active()) retain(asset);
    });
  const applyImage = (asset: MediaAsset) => {
    const operation = imageAction;
    setImageAction(null);
    void action.run(async (active) => {
      if (operation === "embedded") {
        const values = await mediaApi.embeddedVibes(asset.id);
        if (!active()) return;
        if (!values.length) throw new Error("图片中没有嵌入编码。");
        retain(values[0]!);
      } else if (operation === "read") {
        const value = await mediaApi.importPngVibeDocument(asset.id);
        if (!active()) return;
        if (!value) throw new Error("PNG 中没有完整氛围转移文档。");
        retain(value);
      } else if (operation === "document") {
        const value = await mediaApi.createImageVibeDocument(asset.id);
        if (active()) retain(value);
      } else if (operation === "embed" && selected?.kind === "vibeDocument") {
        const value = await mediaApi.embedVibeDocument(selected.id, asset.id);
        if (!active()) return;
        const bytes = await mediaApi.content(value.id);
        if (!active()) return;
        downloadBytes(bytes, "nib-vibe.png", "image/png");
        assets.retry();
      }
    });
  };
  const exportEntry = (entryIndex: number) =>
    void action.run(async (active) => {
      if (!document.value || !selected) return;
      const entry = document.value.entries.find((item) => item.entryIndex === entryIndex);
      if (!entry) return;
      const cache = entry.caches[0];
      const asset = cache
        ? await mediaApi.importDocumentEncoding(
            selected.id,
            entryIndex,
            cache.modelKey,
            cache.parameterKey,
          )
        : await mediaApi.importDocumentImage(selected.id, entryIndex);
      if (!active()) return;
      const exported = cache
        ? await mediaApi.createEncodedVibeDocument(asset.id)
        : await mediaApi.createImageVibeDocument(asset.id);
      if (!active()) return;
      await saveDocument(exported.id, "nib-vibe", active);
      if (active()) assets.retry();
    });
  const canChoose =
    !!selected?.available && (selected.kind !== "vibeDocument" || selection.length > 0);
  return (
    <Modal
      open
      title="氛围转移材料"
      onClose={() => {
        if (!action.busy) onClose();
      }}
      wide
    >
      <div className="vibe-dialog" aria-busy={action.busy}>
        <div className="vibe-toolbar">
          <FilePicker
            label="导入文档"
            disabled={action.busy}
            accept=".naiv4vibe,.naiv4vibebundle,.json"
            onChoose={(chosen) => void file(chosen)}
          />
          <FilePicker
            label="导入编码"
            disabled={action.busy}
            accept=".bin,.vibe"
            onChoose={(chosen) => void file(chosen, "encoded")}
          />
          <ActionsMenu
            label="氛围转移文件操作"
            items={[
              {
                label: "从原图创建文档",
                action: () => setImageAction("document"),
                disabled: action.busy,
              },
              {
                label: "读取 PNG 文档",
                action: () => setImageAction("read"),
                disabled: action.busy,
              },
              {
                label: "提取图片编码",
                action: () => setImageAction("embedded"),
                disabled: action.busy,
              },
            ]}
          />
          <Button
            disabled={action.busy || bundleIds.length === 0}
            onClick={() =>
              void action.run(async (active) => {
                const value = await mediaApi.bundleVibeDocuments(bundleIds);
                if (active()) {
                  retain(value);
                  setBundleIds([]);
                }
              })
            }
          >
            组包（{bundleIds.length}）
          </Button>
          <Button disabled={action.busy || assets.loading} onClick={assets.retry}>
            刷新
          </Button>
        </div>
        {action.error && <Notice>{action.error}</Notice>}
        {assets.error && (
          <Notice actions={<Button onClick={assets.retry}>重试</Button>}>{assets.error}</Notice>
        )}
        <div className="vibe-material-grid">
          <div className="vibe-material-list">
            {assets.loading && <output>正在读取材料…</output>}
            {assets.value?.length === 0 && <p className="muted">尚无材料</p>}
            {assets.value?.map((asset) => (
              <div
                className={`vibe-material-option ${selectedId === asset.id ? "is-selected" : ""}`}
                key={asset.id}
              >
                {asset.kind === "vibeDocument" && (
                  <input
                    type="checkbox"
                    aria-label={`组包 ${vibeMaterialName(asset)}`}
                    checked={bundleIds.includes(asset.id)}
                    disabled={action.busy}
                    onChange={(event) =>
                      setBundleIds(
                        event.currentTarget.checked
                          ? [...bundleIds, asset.id]
                          : bundleIds.filter((id) => id !== asset.id),
                      )
                    }
                  />
                )}
                <button
                  type="button"
                  disabled={action.busy || !asset.available}
                  onClick={() => selectAsset(asset.id)}
                >
                  <strong>{vibeMaterialName(asset)}</strong>
                  <small>
                    {asset.kind === "vibeDocument"
                      ? "文档"
                      : asset.kind === "vibe"
                        ? "编码"
                        : "原图"}
                    {!asset.available && " · 文件不可用"}
                  </small>
                </button>
              </div>
            ))}
          </div>
          <div className="vibe-document-view">
            {selected ? (
              <>
                <h3>{vibeMaterialName(selected)}</h3>
                {selected.kind === "vibeDocument" ? (
                  <>
                    {document.loading && <output>正在检查文档…</output>}
                    {document.error && (
                      <Notice actions={<Button onClick={document.retry}>重试</Button>}>
                        {document.error}
                      </Notice>
                    )}
                    {document.value && (
                      <DocumentEntries
                        view={document.value}
                        selection={selection}
                        onChange={setSelection}
                        single={single}
                        disabled={action.busy}
                        capabilities={capabilities}
                        onExportEntry={exportEntry}
                      />
                    )}
                    <div className="button-group">
                      <Button
                        disabled={action.busy || !document.value}
                        onClick={() =>
                          void action.run(async (active) => {
                            if (active()) await saveDocument(selected.id, "nib-vibe", active);
                          })
                        }
                      >
                        导出{document.value?.isBundle ? "集合" : "单文件"}
                      </Button>
                      <Button disabled={action.busy} onClick={() => setImageAction("embed")}>
                        嵌入 PNG
                      </Button>
                    </div>
                  </>
                ) : selected.kind === "vibe" ? (
                  <>
                    {encoding.loading && <output>正在读取编码信息…</output>}
                    {encoding.error && (
                      <Notice actions={<Button onClick={encoding.retry}>重试读取</Button>}>
                        {encoding.error}
                      </Notice>
                    )}
                    {encoding.value && <VibeAssetInformation inspection={encoding.value} />}
                    <Button
                      disabled={action.busy || !encoding.value?.canExportDocument}
                      onClick={() =>
                        void action.run(async (active) => {
                          const value = await mediaApi.createEncodedVibeDocument(selected.id);
                          if (!active()) return;
                          retain(value);
                          await saveDocument(value.id, "nib-vibe", active);
                        })
                      }
                    >
                      导出单文件
                    </Button>
                    <Button
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async (active) => {
                          const bytes = await mediaApi.content(selected.id);
                          if (active())
                            downloadBytes(bytes, "nib-vibe.bin", "application/octet-stream");
                        })
                      }
                    >
                      导出编码
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="vibe-status">
                      原图 · {selected.width} × {selected.height}
                    </p>
                    {capabilities?.vibeInputPath !== "image" && (
                      <p className="vibe-message">添加原图后，可在参考槽中编码。</p>
                    )}
                  </>
                )}
              </>
            ) : (
              <p className="muted">选择材料或导入文件</p>
            )}
          </div>
        </div>
        <footer className="vibe-toolbar">
          <Button disabled={action.busy} onClick={onClose}>
            关闭
          </Button>
          <span className="spacer" />
          {!single && (
            <Button disabled={action.busy || !canChoose} onClick={() => choose("replace")}>
              替换本组参考
            </Button>
          )}
          <Button
            className="primary"
            disabled={action.busy || !canChoose}
            onClick={() => choose("append")}
          >
            {action.busy ? "正在处理…" : single ? "选择材料" : "追加到参考"}
          </Button>
        </footer>
      </div>
      <ImagePickerDialog
        open={imageAction !== null}
        title={imageAction === "embed" ? "选择承载文档的 PNG" : "选择图片"}
        onClose={() => setImageAction(null)}
        onSelect={applyImage}
      />
    </Modal>
  );
}

function DocumentEntries({
  view,
  selection,
  onChange,
  single,
  disabled,
  capabilities,
  onExportEntry,
}: {
  view: VibeDocumentInspection;
  selection: DocumentSelection[];
  onChange: (value: DocumentSelection[]) => void;
  single: boolean;
  disabled: boolean;
  capabilities: ModelCapabilities | null;
  onExportEntry: (entryIndex: number) => void;
}) {
  const key = (value: DocumentSelection) => JSON.stringify(value);
  const option = (value: DocumentSelection, label: string) => (
    <label className="vibe-cache-option">
      <input
        type={single ? "radio" : "checkbox"}
        name="vibe-cache"
        disabled={disabled}
        checked={selection.some((item) => key(item) === key(value))}
        onChange={(event) =>
          onChange(
            event.currentTarget.checked
              ? single
                ? [value]
                : [...selection, value]
              : selection.filter((item) => key(item) !== key(value)),
          )
        }
      />
      <span>{label}</span>
    </label>
  );
  return (
    <div className="vibe-document-entries">
      {view.entries.map((entry) => (
        <section key={entry.entryIndex}>
          <div className="vibe-toolbar">
            <h4>{entry.name || `条目 ${entry.entryIndex + 1}`}</h4>
            <Button
              disabled={disabled || (!entry.hasImage && !entry.caches.length)}
              onClick={() => onExportEntry(entry.entryIndex)}
            >
              导出单文件
            </Button>
          </div>
          {entry.hasImage ? (
            option(
              { entryIndex: entry.entryIndex, kind: "image" },
              `原图${capabilities?.vibeInputPath === "image" ? " · 当前模型可用" : ""}`,
            )
          ) : (
            <p className="vibe-status">无原图</p>
          )}
          {entry.caches.map((cache) => (
            <div key={JSON.stringify([cache.modelKey, cache.parameterKey])}>
              {option(
                {
                  entryIndex: entry.entryIndex,
                  kind: "encoded",
                  modelKey: cache.modelKey,
                  parameterKey: cache.parameterKey,
                },
                `${cache.modelKey} · 提取量 ${cache.informationExtracted ?? "未记录"}${cache.hasMask ? " · 遮罩" : ""}${cache.modelKey === capabilities?.vibeReferenceOptions.metadataModelKey ? " · 当前模型" : ""}`,
              )}
            </div>
          ))}
          {!entry.caches.length && <p className="vibe-status">无可用编码</p>}
        </section>
      ))}
    </div>
  );
}
