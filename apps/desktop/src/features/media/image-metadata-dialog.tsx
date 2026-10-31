import { errorMessage } from "@/shared/host/error";
import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { KnownImageMetadata, MediaAsset, MetadataRestore } from "@/bindings/media";
import type { Draft } from "@/bindings/workbench";
import { ActionsMenu, Button, Modal, Notice } from "@/shared/ui";
import { useMediaTools } from "./media-tools-context";
import { mediaApi } from "./api";
import { imageName, imageUnavailableReason } from "./model";
import { useMediaQuery } from "./use-media-query";
import "./media.css";
import { PromptTextEditor } from "@/features/prompt/prompt-text-editor";
import { settingLabels, settingValue, type SettingKey } from "@/features/prompt/settings";

const statusLabels = {
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

function MetadataField({ label, value }: { label: string; value: ReactNode }) {
  useTranslation();

  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? t("media.notRecorded")}</dd>
    </div>
  );
}

function KnownFields({ metadata }: { metadata: KnownImageMetadata }) {
  useTranslation();

  return (
    <>
      <dl className="media-metadata-fields">
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
      <section className="media-literal-content">
        <h3>{t("media.recordedPositivePrompt")}</h3>
        <PromptTextEditor
          value={metadata.prompt ?? ""}
          label={t("media.recordedPositivePrompt")}
          placeholder={t("media.notRecorded")}
          model={metadata.model ?? undefined}
          context="native"
          readOnly
          tokenUnavailableLabel={t("media.modelNotRecorded")}
        />
        <h3>{t("media.recordedNegativePrompt")}</h3>
        <PromptTextEditor
          value={metadata.negativePrompt ?? ""}
          label={t("media.recordedNegativePrompt")}
          placeholder={t("media.notRecorded")}
          model={metadata.model ?? undefined}
          context="native"
          readOnly
          tokenUnavailableLabel={t("media.modelNotRecorded")}
        />
      </section>
      {metadata.characters.length > 0 && (
        <section className="media-literal-content">
          <h3>{t("media.characterText")}</h3>
          <p className="muted">{t("media.characterTextDescription")}</p>
          {metadata.characters.map((character, index) => (
            <div key={index}>
              <h4>
                {t("media.sourceCharacterIndex")}
                {character.sourceIndex}
              </h4>
              <span className="muted">{t("media.positive")}</span>
              <PromptTextEditor
                value={character.prompt ?? ""}
                label={t("media.characterPositivePrompt", { value0: character.sourceIndex + 1 })}
                model={metadata.model ?? undefined}
                context="native"
                readOnly
                tokenUnavailableLabel={t("media.modelNotRecorded")}
              />
              <span className="muted">{t("media.negative")}</span>
              <PromptTextEditor
                value={character.negativePrompt ?? ""}
                label={t("media.characterNegativePrompt", { value0: character.sourceIndex + 1 })}
                model={metadata.model ?? undefined}
                context="native"
                readOnly
                tokenUnavailableLabel={t("media.modelNotRecorded")}
              />
            </div>
          ))}
        </section>
      )}
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
    <section className="metadata-restore-preview" aria-label={t("media.restorePreview")}>
      <h3>{t("media.restoreCreation")}</h3>
      <p>{t("media.restoreConsequences")}</p>
      <ul className="media-notices">
        {notices.map((notice, index) => (
          <li key={index}>{errorMessage(notice)}</li>
        ))}
      </ul>
      <details open className="media-literal-content">
        <summary>{t("media.contentToUse")}</summary>
        <h4>{t("media.positivePrompt")}</h4>
        <PromptTextEditor
          value={draft.composition.positive
            .map((node) =>
              node.kind === "text" ? node.text : (node.overrideText ?? t("media.chunkReferences")),
            )
            .join("\n")}
          label={t("media.restorePositivePrompt")}
          model={draft.settings.model ?? undefined}
          readOnly
          tokenUnavailableLabel={t("media.modelNotRecorded")}
        />
        <h4>{t("media.negativePrompt")}</h4>
        <PromptTextEditor
          value={draft.composition.negative
            .map((node) =>
              node.kind === "text" ? node.text : (node.overrideText ?? t("media.chunkReferences")),
            )
            .join("\n")}
          label={t("media.restoreNegativePrompt")}
          model={draft.settings.model ?? undefined}
          readOnly
          tokenUnavailableLabel={t("media.modelNotRecorded")}
        />
        <h4>{t("media.knownSettings")}</h4>
        <dl className="media-metadata-fields">
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
        <p className="muted">
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
      <div className="ui-actions">
        <Button onClick={cancel}>{t("media.keepCreation")}</Button>
        <Button className="primary" onClick={confirm}>
          {t("media.replaceCreation")}
        </Button>
      </div>
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
      <div className="media-metadata-dialog">
        <p className="media-asset-heading">
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
            <output>{statusLabels[report.value.status]}</output>
            {report.value.warnings.length > 0 && (
              <ul className="media-notices" aria-label={t("media.metadataNotice")}>
                {report.value.warnings.map((warning, index) => (
                  <li key={index}>{errorMessage(warning)}</li>
                ))}
              </ul>
            )}
            {report.value.generation && <KnownFields metadata={report.value.generation} />}
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
