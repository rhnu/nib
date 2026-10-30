import { t, useTranslation, deferMessage, MessageError } from "@/shared/i18n";
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
  useTranslation();

  return open ? <Materials {...props} /> : null;
}

function Materials({
  onClose,
  onSelect,
  capabilities,
  initialAssetId,
  single = false,
}: Omit<VibeMaterialDialogProps, "open">) {
  useTranslation();

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
        if (!values.length)
          throw new MessageError(deferMessage(() => t("vibes.noEmbeddedEncoding")));
        retain(values[0]!);
      } else if (operation === "read") {
        const value = await mediaApi.importPngVibeDocument(asset.id);
        if (!active()) return;
        if (!value) throw new MessageError(deferMessage(() => t("vibes.noCompletePngDocument")));
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
      title={t("vibes.vibeMaterials")}
      onClose={() => {
        if (!action.busy) onClose();
      }}
      wide
    >
      <div className="vibe-dialog" aria-busy={action.busy}>
        <div className="vibe-toolbar">
          <FilePicker
            label={t("vibes.importDocument")}
            disabled={action.busy}
            accept=".naiv4vibe,.naiv4vibebundle,.json"
            onChoose={(chosen) => void file(chosen)}
          />
          <FilePicker
            label={t("vibes.importEncoding")}
            disabled={action.busy}
            accept=".bin,.vibe"
            onChoose={(chosen) => void file(chosen, "encoded")}
          />
          <ActionsMenu
            label={t("vibes.vibeFileActions")}
            items={[
              {
                label: t("vibes.createDocumentFromOriginal"),
                action: () => setImageAction("document"),
                disabled: action.busy,
              },
              {
                label: t("vibes.readPngDocument"),
                action: () => setImageAction("read"),
                disabled: action.busy,
              },
              {
                label: t("vibes.extractImageEncoding"),
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
            {t("vibes.bundleCount", { count: bundleIds.length })}
          </Button>
          <Button disabled={action.busy || assets.loading} onClick={assets.retry}>
            {t("vibes.refresh")}
          </Button>
        </div>
        {action.error && <Notice>{action.error}</Notice>}
        {assets.error && (
          <Notice actions={<Button onClick={assets.retry}>{t("vibes.retry")}</Button>}>
            {assets.error}
          </Notice>
        )}
        <div className="vibe-material-grid">
          <div className="vibe-material-list">
            {assets.loading && <output>{t("vibes.loadingMaterials")}</output>}
            {assets.value?.length === 0 && <p className="muted">{t("vibes.noMaterials")}</p>}
            {assets.value?.map((asset) => (
              <div
                className={`vibe-material-option ${selectedId === asset.id ? "is-selected" : ""}`}
                key={asset.id}
              >
                {asset.kind === "vibeDocument" && (
                  <input
                    type="checkbox"
                    aria-label={t("vibes.bundleMaterial", { value0: vibeMaterialName(asset) })}
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
                      ? t("vibes.document")
                      : asset.kind === "vibe"
                        ? t("vibes.encodedMaterial")
                        : t("vibes.originalImage")}
                    {!asset.available && t("vibes.fileUnavailableTag")}
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
                    {document.loading && <output>{t("vibes.inspectingDocument")}</output>}
                    {document.error && (
                      <Notice
                        actions={<Button onClick={document.retry}>{t("vibes.retry")}</Button>}
                      >
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
                        {t("vibes.exportPrefix")}
                        {document.value?.isBundle
                          ? t("vibes.bundleExportSuffix")
                          : t("vibes.singleFileExportSuffix")}
                      </Button>
                      <Button disabled={action.busy} onClick={() => setImageAction("embed")}>
                        {t("vibes.embedInPng")}
                      </Button>
                    </div>
                  </>
                ) : selected.kind === "vibe" ? (
                  <>
                    {encoding.loading && <output>{t("vibes.loadingEncodingInfo")}</output>}
                    {encoding.error && (
                      <Notice
                        actions={<Button onClick={encoding.retry}>{t("vibes.retryRead")}</Button>}
                      >
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
                      {t("vibes.exportSingleFile")}
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
                      {t("vibes.exportEncoding")}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="vibe-status">
                      {t("vibes.originalImagePrefix")}
                      {selected.width} × {selected.height}
                    </p>
                    {capabilities?.vibeInputPath !== "image" && (
                      <p className="vibe-message">{t("vibes.originalEncodingHelp")}</p>
                    )}
                  </>
                )}
              </>
            ) : (
              <p className="muted">{t("vibes.selectOrImport")}</p>
            )}
          </div>
        </div>
        <footer className="vibe-toolbar">
          <Button disabled={action.busy} onClick={onClose}>
            {t("vibes.off")}
          </Button>
          <span className="spacer" />
          {!single && (
            <Button disabled={action.busy || !canChoose} onClick={() => choose("replace")}>
              {t("vibes.replaceReferenceGroup")}
            </Button>
          )}
          <Button
            className="primary"
            disabled={action.busy || !canChoose}
            onClick={() => choose("append")}
          >
            {action.busy
              ? t("vibes.processing")
              : single
                ? t("vibes.chooseMaterial")
                : t("vibes.appendReferences")}
          </Button>
        </footer>
      </div>
      <ImagePickerDialog
        open={imageAction !== null}
        title={imageAction === "embed" ? t("vibes.chooseDocumentPng") : t("vibes.chooseImage")}
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
  useTranslation();

  const key = (value: DocumentSelection) => JSON.stringify(value);

  const option = (value: DocumentSelection, label: string) => (
    <label className="vibe-cache-option">
      <input
        type={single ? "radio" : "checkbox"}
        name={t("vibes.vibeCache")}
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
            <h4>{entry.name || t("vibes.entryNumber", { value0: entry.entryIndex + 1 })}</h4>
            <Button
              disabled={disabled || (!entry.hasImage && !entry.caches.length)}
              onClick={() => onExportEntry(entry.entryIndex)}
            >
              {t("vibes.exportSingleFile")}
            </Button>
          </div>
          {entry.hasImage ? (
            option(
              { entryIndex: entry.entryIndex, kind: "image" },
              t("vibes.originalImageStatus", {
                value0:
                  capabilities?.vibeInputPath === "image"
                    ? t("vibes.currentModelAvailableTag")
                    : "",
              }),
            )
          ) : (
            <p className="vibe-status">{t("vibes.noOriginalImage")}</p>
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
                t("vibes.encodingSummary", {
                  value0: cache.modelKey,
                  value1: cache.informationExtracted ?? t("vibes.notRecorded"),
                  value2: cache.hasMask ? t("vibes.maskTag") : "",
                  value3:
                    cache.modelKey === capabilities?.vibeReferenceOptions.metadataModelKey
                      ? t("vibes.currentModelTag")
                      : "",
                }),
              )}
            </div>
          ))}
          {!entry.caches.length && <p className="vibe-status">{t("vibes.noEncoding")}</p>}
        </section>
      ))}
    </div>
  );
}
