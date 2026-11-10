import {
  Row,
  ButtonGroup,
  Grid,
  ActionsMenu,
  Button,
  IconButton,
  Modal,
  Notice,
  notify,
} from "@/shared/ui";

import { errorMessage } from "@/shared/host/error";
import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { KnownImageMetadata, MediaAsset, MetadataRestore } from "@/bindings/media";
import type { Draft } from "@/bindings/workbench";
import { Copy } from "lucide-react";

import { useMediaTools } from "./media-tools-context";
import { mediaApi } from "./api";
import { imageName, imageUnavailableReason } from "./model";
import { useMediaQuery } from "./use-media-query";
import { PromptTextEditor } from "@/features/prompt/prompt-text-editor";
import { settingLabels, settingValue, type SettingKey } from "@/features/prompt/settings";

const metadataStatusLabels = {
  get parsed() {
    return t("media.metadataParsed");
  },
  get notPresent() {
    return t("media.metadataAbsent");
  },
  get unsupportedFormat() {
    return t("media.metadataUnsupported");
  },
  get invalid() {
    return t("media.metadataInvalid");
  },
};
const origins = {
  get png_text() {
    return t("media.pngTextChunks");
  },
  get exif_user_comment() {
    return t("media.exifUserComment");
  },
  get stealth_png_comp() {
    return t("media.stealthPng");
  },
};

/** Copy the recorded value exactly, without the editable prompt conversion. */
function MetadataPromptHeading({ label, value }: { label: string; value: string | null }) {
  return (
    <Row
      gap={0}
      className="flex items-center justify-between gap-space-3 min-w-0 min-h-control mb-space-2 [&_>_:is(h2,_h3)]:m-0 [&_>_:is(h2,_h3)]:min-w-0 [&_>_:is(h2,_h3)]:text-section [&_>_:is(h2,_h3)]:font-semibold"
    >
      <h3>{label}</h3>
      <IconButton
        label={`${t("common.copy")} · ${label}`}
        disabled={value === null}
        onClick={() => {
          void navigator.clipboard
            .writeText(value ?? "")
            .then(() => notify(() => t("media.promptCopied")))
            .catch((cause: unknown) => notify(() => errorMessage(cause), "copy-metadata", true));
        }}
      >
        <Copy size={15} aria-hidden />
      </IconButton>
    </Row>
  );
}

function MetadataField({ label, value }: { label: string; value: ReactNode }) {
  useTranslation();

  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? t("media.notRecorded")}</dd>
    </div>
  );
}

/** Recorded positive and negative prompts share one row and preserve independent copy actions. */
function MetadataPromptPair({
  positive,
  negative,
  positiveLabel,
  negativeLabel,
  model,
  context = "native",
}: {
  positive: string | null;
  negative: string | null;
  positiveLabel: string;
  negativeLabel: string;
  model?: string;
  context?: "native" | "editable";
}) {
  return (
    <Grid
      columns={1}
      align="stretch"
      gap={0}
      minColumnWidth="0px"
      className="media-prompt-pair grid grid-cols-2 gap-space-5"
    >
      {[
        { label: positiveLabel, value: positive },
        { label: negativeLabel, value: negative },
      ].map(({ label, value }) => (
        <div className="media-prompt-value [&_.section-heading_h3]:m-0 min-w-0" key={label}>
          <MetadataPromptHeading label={label} value={value} />
          <PromptTextEditor
            value={value ?? ""}
            label={label}
            placeholder={t("media.notRecorded")}
            model={model}
            context={context}
            readOnly
            tokenUnavailableLabel={t("media.modelNotRecorded")}
          />
        </div>
      ))}
    </Grid>
  );
}

export function ImageMetadataFields({ metadata }: { metadata: KnownImageMetadata }) {
  useTranslation();
  return (
    <>
      <section className="media-literal-content [&_pre]:whitespace-pre-wrap [&_pre]:wrap-anywhere [&_pre]:[border:1px_solid_var(--line-subtle)] [&_pre]:rounded-control [&_pre]:p-[9px] [&_pre]:bg-background [&_h3]:m-[15px_0_7px] [&_h4]:m-[15px_0_7px]">
        <MetadataPromptPair
          positive={metadata.prompt}
          negative={metadata.negativePrompt}
          positiveLabel={t("media.recordedPositivePrompt")}
          negativeLabel={t("media.recordedNegativePrompt")}
          model={metadata.model ?? undefined}
        />
      </section>
      {metadata.characters.length > 0 && (
        <section className="media-literal-content [&_pre]:whitespace-pre-wrap [&_pre]:wrap-anywhere [&_pre]:[border:1px_solid_var(--line-subtle)] [&_pre]:rounded-control [&_pre]:p-[9px] [&_pre]:bg-background [&_h3]:m-[15px_0_7px] [&_h4]:m-[15px_0_7px] media-character-content">
          <h3>{t("media.characterText")}</h3>
          {metadata.characters.map((character) => (
            <div key={character.sourceIndex}>
              <h4>{t("media.characterLabel", { index: character.sourceIndex + 1 })}</h4>
              <MetadataPromptPair
                positive={character.prompt}
                negative={character.negativePrompt}
                positiveLabel={t("media.positive")}
                negativeLabel={t("media.negative")}
                model={metadata.model ?? undefined}
              />
            </div>
          ))}
        </section>
      )}
      <details>
        <summary>{t("media.knownSettings")}</summary>
        <dl className="media-metadata-fields [&_>_div]:grid [&_>_div]:grid-cols-[minmax(110px,_0.35fr)_minmax(0,_1fr)] [&_>_div]:gap-[9px] [&_>_div]:p-[5px_0] [&_>_div]:[border-bottom:1px_solid_var(--line-subtle)] [&_dt]:text-muted [&_dd]:m-0 [&_dd]:wrap-anywhere m-[var(--space-4)_0]">
          <MetadataField
            label={t("media.metadataCarrier")}
            value={
              metadata.origin === null ? null : `${origins[metadata.origin]} (${metadata.origin})`
            }
          />
          <MetadataField label={t("media.model")} value={metadata.model} />
          <MetadataField label={t("media.seed")} value={metadata.seed} />
          <MetadataField
            label={t("media.dimensions")}
            value={metadata.size && `${metadata.size.width} × ${metadata.size.height}`}
          />
          <MetadataField label={t("media.steps")} value={metadata.steps} />
          <MetadataField label={t("media.sampler")} value={metadata.sampler} />
          <MetadataField label={t("media.guidance")} value={metadata.scale} />
          <MetadataField label={t("media.noiseSchedule")} value={metadata.noiseSchedule} />
          <MetadataField label={t("media.cfgRescale")} value={metadata.cfgRescale} />
          <MetadataField label={t("media.legacyUcIndex")} value={metadata.ucPreset} />
          <MetadataField
            label={t("media.qualityTagsToggle")}
            value={metadata.qualityToggle === null ? null : String(metadata.qualityToggle)}
          />
          <MetadataField label={t("media.source")} value={metadata.source} />
          <MetadataField label={t("media.software")} value={metadata.software} />
          <MetadataField label={t("media.embeddedVibeCount")} value={metadata.embeddedVibeCount} />
        </dl>
      </details>
    </>
  );
}

function RestorePreview({
  restore,
  confirm,
  cancel,
}: {
  restore: MetadataRestore;
  confirm: () => void;
  cancel: () => void;
}) {
  useTranslation();

  const { draft, notices } = restore;
  return (
    <section
      className="metadata-restore-preview [&_>_h3]:text-foreground mt-space-5 [border:1px_solid_var(--accent)] rounded-control p-space-4"
      aria-label={t("media.restorePreview")}
    >
      <h3>{t("media.restoreCreation")}</h3>
      <p>{t("media.restoreConsequences")}</p>
      <ul className="media-notices pl-[20px] wrap-anywhere">
        {notices.map((notice, index) => (
          <li key={index}>{errorMessage(notice)}</li>
        ))}
      </ul>
      <details
        open
        className="media-literal-content [&_pre]:whitespace-pre-wrap [&_pre]:wrap-anywhere [&_pre]:[border:1px_solid_var(--line-subtle)] [&_pre]:rounded-control [&_pre]:p-[9px] [&_pre]:bg-background [&_h3]:m-[15px_0_7px] [&_h4]:m-[15px_0_7px]"
      >
        <summary>{t("media.contentToUse")}</summary>
        <MetadataPromptPair
          positive={draft.composition.positive
            .map((node) =>
              node.kind === "text" ? node.text : (node.overrideText ?? t("media.chunkReferences")),
            )
            .join("\n")}
          negative={draft.composition.negative
            .map((node) =>
              node.kind === "text" ? node.text : (node.overrideText ?? t("media.chunkReferences")),
            )
            .join("\n")}
          positiveLabel={t("media.positivePrompt")}
          negativeLabel={t("media.negativePrompt")}
          model={draft.settings.model ?? undefined}
          context="editable"
        />
        <h4>{t("media.knownSettings")}</h4>
        <dl className="media-metadata-fields [&_>_div]:grid [&_>_div]:grid-cols-[minmax(110px,_0.35fr)_minmax(0,_1fr)] [&_>_div]:gap-[9px] [&_>_div]:p-[5px_0] [&_>_div]:[border-bottom:1px_solid_var(--line-subtle)] [&_dt]:text-muted [&_dd]:m-0 [&_dd]:wrap-anywhere m-[var(--space-4)_0]">
          {Object.entries(draft.settings)
            .filter(([, value]) => value !== null)
            .map(([key, value]) => (
              <MetadataField
                key={key}
                label={settingLabels[key as SettingKey]}
                value={settingValue(key as SettingKey, value)}
              />
            ))}
        </dl>
        <p className="muted text-muted">
          {t("media.presetCountPrefix")}
          {draft.presets.length}
          {t("media.characterCountPrefix")}
          {draft.characters.length}
          {t("media.operationPrefix")}{" "}
          {draft.inputs.operation.kind === "textToImage"
            ? t("media.textToImage")
            : t("media.imageOperation")}
        </p>
      </details>
      <ButtonGroup
        gap={0}
        className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
      >
        <Button onClick={cancel}>{t("media.keepCreation")}</Button>
        <Button variant="primary" className="" onClick={confirm}>
          {t("media.replaceCreation")}
        </Button>
      </ButtonGroup>
    </section>
  );
}

function MetadataDialogContent({
  asset,
  onClose,
  onRestore,
  onOpenTool,
}: {
  asset: MediaAsset;
  onClose: () => void;
  onRestore?: (draft: Draft) => void;
  onOpenTool?: () => void;
}) {
  useTranslation();

  const tools = useMediaTools();
  const unavailable = imageUnavailableReason(asset);
  const report = useMediaQuery(
    ["media", "metadata", asset.id],
    unavailable ? null : asset.id,
    mediaApi.metadata,
  );
  const [restore, setRestore] = useState<MetadataRestore | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useMessageState();
  const current = useRef({ active: true, locked: false });
  useEffect(() => {
    const state = current.current;
    state.active = true;
    return () => {
      state.active = false;
    };
  }, []);

  const prepareRestore = async () => {
    if (current.current.locked) return;
    current.current.locked = true;
    setRestoring(true);
    setRestoreError(null);
    try {
      const preview = await mediaApi.restoreMetadata(asset.id);
      if (current.current.active) setRestore(preview);
    } catch (cause) {
      if (current.current.active) setRestoreError(cause);
    } finally {
      current.current.locked = false;
      if (current.current.active) setRestoring(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t("media.imageMetadata")} wide>
      <div className="media-metadata-dialog overflow-auto p-[14px_17px] min-h-0">
        <p className="media-asset-heading wrap-anywhere">
          {imageName(asset)} · {asset.mimeType}
        </p>
        {tools && asset.mimeType === "image/png" && (
          <ActionsMenu
            label={t("media.advancedImageActions")}
            items={[
              {
                label: t("media.pngText"),
                disabled: Boolean(unavailable),
                action: () => {
                  onClose();
                  onOpenTool?.();
                  tools.onPngText(asset);
                },
              },
            ]}
          />
        )}
        {unavailable && <Notice>{unavailable}</Notice>}
        {report.loading && <output>{t("media.inspectingMetadata")}</output>}
        {report.error && (
          <Notice actions={<Button onClick={report.retry}>{t("media.retryInspection")}</Button>}>
            {report.error}
          </Notice>
        )}
        {report.value && (
          <>
            <output>{metadataStatusLabels[report.value.status]}</output>
            {report.value.warnings.length > 0 && (
              <ul
                className="media-notices pl-[20px] wrap-anywhere"
                aria-label={t("media.metadataNotice")}
              >
                {report.value.warnings.map((warning, index) => (
                  <li key={index}>{errorMessage(warning)}</li>
                ))}
              </ul>
            )}
            {report.value.generation && <ImageMetadataFields metadata={report.value.generation} />}
            {onRestore && report.value.status === "parsed" && !restore && (
              <Button disabled={restoring || !!unavailable} onClick={() => void prepareRestore()}>
                {restoring
                  ? t("media.loadingRestorePreview")
                  : restoreError
                    ? t("media.retryRestorePreview")
                    : t("media.previewRestore")}
              </Button>
            )}
          </>
        )}
        {restoreError && <Notice>{restoreError}</Notice>}
        {restore && onRestore && (
          <RestorePreview
            restore={restore}
            cancel={() => {
              setRestore(null);
              setRestoreError(null);
            }}
            confirm={() => {
              onRestore(restore.draft);
              onClose();
            }}
          />
        )}
      </div>
    </Modal>
  );
}

export function ImageMetadataDialog(props: {
  asset: MediaAsset;
  onClose: () => void;
  onRestore?: (draft: Draft) => void;
  onOpenTool?: () => void;
}) {
  useTranslation();

  return <MetadataDialogContent key={props.asset.id} {...props} />;
}
