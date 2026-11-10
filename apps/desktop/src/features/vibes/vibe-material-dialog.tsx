import {
  ButtonGroup,
  Col,
  Grid,
  Row,
  Input,
  ActionsMenu,
  Button,
  FilePicker,
  Modal,
  Notice,
} from "@/shared/ui";

import { t, useTranslation, deferMessage, MessageError } from "@/shared/i18n";
import { useLayoutEffect, useRef, useState } from "react";
import type { MediaAsset, VibeDocumentInspection } from "@/bindings/media";
import type { ModelCapabilities, VibeReferenceInput } from "@/bindings/workbench";

import { ImagePickerDialog } from "@/features/media";
import { mediaApi } from "@/features/media/api";
import { ImageExportActions } from "@/features/media/image-export";
import { useMediaQuery } from "@/features/media/use-media-query";
import { VibeAssetInformation } from "./vibe-asset-details";
import { vibeMaterialName } from "./model";
import { saveExportFile } from "@/shared/host/file-export";
import { useVibeAction } from "./use-vibe-action";

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
  const [embeddedOutput, setEmbeddedOutput] = useState<MediaAsset | null>(null);
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
    setEmbeddedOutput(null);
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
      await saveExportFile(
        bytes,
        `${name}.${inspection.isBundle ? "naiv4vibeBundle" : "naiv4vibe"}`,
      );
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
        setEmbeddedOutput(value);
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
      <Col
        gap={0}
        className="vibe-dialog flex gap-space-3 min-w-0 flex-1 flex-col min-h-0 p-space-5 overflow-hidden"
        aria-busy={action.busy}
      >
        <div className="vibe-toolbar flex items-center gap-[5px] flex-wrap">
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
        <Grid
          columns={1}
          align="stretch"
          gap={0}
          minColumnWidth="0px"
          className="vibe-material-grid max-[700px]:grid-cols-[1fr] grid flex-1 grid-cols-[minmax(180px,_1fr)_minmax(0,_2fr)] gap-space-5 min-h-0"
        >
          <Grid
            align="stretch"
            gap={0}
            columns={1}
            minColumnWidth="0px"
            className="vibe-material-list max-[700px]:max-h-[24vh] grid content-start gap-space-3 min-w-0 overflow-auto"
          >
            {assets.loading && <output>{t("vibes.loadingMaterials")}</output>}
            {assets.value?.length === 0 && (
              <p className="muted text-muted">{t("vibes.noMaterials")}</p>
            )}
            {assets.value?.map((asset) => (
              <Row
                gap={0}
                className={`vibe-material-option [&.is-selected]:border-accent [&_>_button]:flex-1 [&_>_button]:grid [&_>_button]:gap-[3px] [&_>_button]:min-w-0 [&_>_button]:p-[9px] [&_>_button]:bg-transparent [&_>_button]:text-left [&_>_button]:[color:inherit] [&_>_button]:[border:0] [&_>_button]:cursor-pointer [&_>_button]:wrap-anywhere [&_small]:text-muted [&_>_input]:ml-space-3 [&_>_input]:w-[16px] [&_>_input]:h-[16px] [&_>_input]:min-h-0 [&_>_input]:p-0 [&_>_input]:[flex:none] [&_>_input]:accent-accent flex items-center gap-[5px] [border:1px_solid_var(--line-subtle)] rounded-control ${selectedId === asset.id ? "is-selected" : ""}`}
                key={asset.id}
              >
                {asset.kind === "vibeDocument" && (
                  <Input
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
                <Button
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
                </Button>
              </Row>
            ))}
          </Grid>
          <Grid
            align="stretch"
            gap={0}
            columns={1}
            minColumnWidth="0px"
            className="vibe-document-view grid content-start gap-space-3 min-w-0 overflow-auto"
          >
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
                    <ButtonGroup gap={0} className="button-group">
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
                    </ButtonGroup>
                    {embeddedOutput && (
                      <ButtonGroup gap={0} className="button-group">
                        <span>{t("media.embeddedImage")}</span>
                        <ImageExportActions
                          key={embeddedOutput.id}
                          id={embeddedOutput.id}
                          mimeType={embeddedOutput.mimeType}
                          available={!action.busy && embeddedOutput.available}
                          filename="nib-vibe.png"
                        />
                      </ButtonGroup>
                    )}
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
                          if (active()) await saveExportFile(bytes, "nib-vibe.bin");
                        })
                      }
                    >
                      {t("vibes.exportEncoding")}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="vibe-status text-label text-muted wrap-anywhere">
                      {t("vibes.originalImagePrefix")}
                      {selected.width} × {selected.height}
                    </p>
                    {capabilities?.vibeInputPath !== "image" && (
                      <p className="vibe-message m-0 text-danger text-label wrap-anywhere">
                        {t("vibes.originalEncodingHelp")}
                      </p>
                    )}
                  </>
                )}
              </>
            ) : (
              <p className="muted text-muted">{t("vibes.selectOrImport")}</p>
            )}
          </Grid>
        </Grid>
        <footer className="vibe-toolbar flex items-center gap-[5px] flex-wrap">
          <Button disabled={action.busy} onClick={onClose}>
            {t("vibes.off")}
          </Button>
          <span className="flex-1" />
          {!single && (
            <Button disabled={action.busy || !canChoose} onClick={() => choose("replace")}>
              {t("vibes.replaceReferenceGroup")}
            </Button>
          )}
          <Button
            variant="primary"
            className=""
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
      </Col>
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
    <Row
      as="label"
      gap={0}
      className="vibe-cache-option [&_>_input]:w-[16px] [&_>_input]:h-[16px] [&_>_input]:min-h-0 [&_>_input]:p-0 [&_>_input]:[flex:none] [&_>_input]:accent-accent [&_>_input]:m-[2px_0_0] flex items-start gap-space-2 p-[5px_0] text-body wrap-anywhere"
    >
      <Input
        autoComplete="off"
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
    </Row>
  );

  return (
    <Grid
      align="stretch"
      gap={0}
      columns={1}
      minColumnWidth="0px"
      className="vibe-document-entries [&_>_section]:p-[8px_0] [&_>_section]:[border-bottom:1px_solid_var(--line-subtle)] [&_h4]:m-[0_0_7px] grid gap-space-3 min-w-0"
    >
      {view.entries.map((entry) => (
        <section key={entry.entryIndex}>
          <div className="vibe-toolbar flex items-center gap-[5px] flex-wrap">
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
            <p className="vibe-status text-label text-muted wrap-anywhere">
              {t("vibes.noOriginalImage")}
            </p>
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
          {!entry.caches.length && (
            <p className="vibe-status text-label text-muted wrap-anywhere">
              {t("vibes.noEncoding")}
            </p>
          )}
        </section>
      ))}
    </Grid>
  );
}
