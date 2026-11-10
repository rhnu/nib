import { Row, Button, HelpMarker, IconButton, Select } from "@/shared/ui";

import { MediaInputLayout, MediaInputSettings } from "@/features/media/media-input-layout";

import { t, useTranslation } from "@/shared/i18n";
import { Popover } from "@base-ui/react/popover";
import { X } from "lucide-react";

import { ImageImporter } from "@/features/media/image-importer";
import { ImagePickerDialog } from "@/features/media/image-picker-dialog";
import { ImageMetadataDialog } from "@/features/media/image-metadata-dialog";
import { operationLabel } from "./image-operation";
import { InpaintSettings } from "./inpaint-settings";
import {
  useImageOperationPanel,
  type ImageOperationPanelProps,
} from "./model/use-image-operation-panel";
import { useImageOperationFeedback } from "./ui/image-operation-feedback";
import { AppliedMaskInput, ImageSourceInput } from "./ui/image-source-input";
import { ImageToImageSettings } from "./ui/image-to-image-settings";
import { UpscaleSettings } from "./ui/upscale-settings";

/** Composes source selection and operation settings while the draft owns all input values. */
export function ImageOperationPanel(props: ImageOperationPanelProps) {
  useTranslation();

  const {
    draft,
    capabilities,
    estimate,
    diagnostics: providedDiagnostics,
    errorFields = [],
    models,
    onRestore,
    onReturnToText,
    inputVersion,
    onEditMask,
  } = props;
  const {
    operation,
    currentAction,
    importAction,
    setImportAction,
    action,
    sourceId,
    media,
    mask,
    pickerOpen,
    setPickerOpen,
    metadataAsset,
    setMetadataAsset,
    options,
    optionsError,
    retryOptions,
    requestSource,
    prepareImportedSource,
    selectAction,
    updateOperation,
  } = useImageOperationPanel(props);
  const diagnostics = providedDiagnostics ?? estimate?.diagnostics ?? [];
  const feedback = useImageOperationFeedback(diagnostics, errorFields);
  const { controlProps, messages } = feedback;
  return (
    <Popover.Root open={feedback.showAdvanced} onOpenChange={feedback.setAdvancedOpen}>
      <section className="image-operation-panel [&_>_*_+_*]:mt-[10px] [&_[aria-invalid='true']]:[outline:1px_solid_var(--danger)] [&_[aria-invalid='true']]:outline-offset-[1px] media-input-container [container-type:inline-size]">
        <Row
          as="header"
          gap={0}
          className="flex items-center justify-between gap-space-3 min-w-0 min-h-control mb-space-2 [&_>_:is(h2,_h3)]:m-0 [&_>_:is(h2,_h3)]:min-w-0 [&_>_:is(h2,_h3)]:text-section [&_>_:is(h2,_h3)]:font-semibold"
        >
          <h2>
            {t("inputs.imageInput")}
            <HelpMarker label={t("inputs.imageInputHelpTitle")}>
              {t("inputs.imageInputHelp")}
            </HelpMarker>
          </h2>
          {sourceId && (
            <IconButton
              label={t("inputs.removeInput")}
              onClick={() => {
                setImportAction(null);
                onReturnToText();
              }}
            >
              <X size={14} />
            </IconButton>
          )}
        </Row>
        {draft.maskEditor.sessions.some(
          (session) => session.revision !== session.appliedRevision,
        ) && (
          <Row
            gap={0}
            className="image-source-actions [&_.image-importer]:[flex:1_1_auto] flex items-center flex-wrap gap-space-2"
            aria-label={t("inputs.unfinishedMasks")}
          >
            {draft.maskEditor.sessions
              .filter((session) => session.revision !== session.appliedRevision)
              .map((session, index) => (
                <Button
                  key={session.sourceAssetId}
                  onClick={() => onEditMask(session.sourceAssetId)}
                >
                  {t("inputs.continueMaskPrefix")}
                  {index + 1} · {session.width} × {session.height}
                </Button>
              ))}
          </Row>
        )}
        {!sourceId && (
          <Row
            gap={0}
            className="image-source-actions [&_.image-importer]:[flex:1_1_auto] flex items-center flex-wrap gap-space-2"
          >
            <ImageImporter
              key={JSON.stringify([
                operation.kind,
                sourceId,
                currentAction,
                importAction,
                inputVersion,
              ])}
              onImported={prepareImportedSource}
              label={t("inputs.chooseFile")}
              onChooseExisting={() => setPickerOpen(true)}
            />
          </Row>
        )}
        {sourceId && (
          <MediaInputLayout>
            <ImageSourceInput
              media={media}
              sourceId={sourceId}
              operationKind={operation.kind}
              capabilities={capabilities}
              onMetadata={setMetadataAsset}
              onEditMask={onEditMask}
              onReplace={() => setPickerOpen(true)}
            />
            <MediaInputSettings>
              <div className="image-source-operation min-w-0" data-setting-field="maxEnhance">
                <Select
                  {...controlProps("maxEnhance")}
                  aria-label={t("inputs.imageOperation")}
                  value={action ?? operation.kind}
                  onValueChange={selectAction}
                  options={[
                    { value: "imageToImage", label: t("inputs.imageToImage") },
                    {
                      value: "maxEnhance",
                      label: t("inputs.maxEnhance"),
                      disabled: capabilities?.maxEnhance === false,
                    },
                    { value: "upscale", label: t("inputs.standaloneUpscale") },
                    {
                      value: "inpainting",
                      label: t("inputs.inpainting"),
                      disabled: capabilities?.inpainting === false,
                    },
                    ...(currentAction === null
                      ? [{ value: operation.kind, label: operationLabel(operation) }]
                      : []),
                  ]}
                />
                {messages("maxEnhance")}
              </div>
              {operation.kind === "inpainting" && (
                <InpaintSettings
                  key={`${sourceId}:${operation.maskAssetId}:${inputVersion}`}
                  operation={operation}
                  capabilities={capabilities}
                  defaults={options?.inpaintConditioning ?? null}
                  optionsError={optionsError}
                  retryOptions={retryOptions}
                  diagnostics={diagnostics}
                  errorFields={errorFields}
                  update={(change) =>
                    updateOperation((current) =>
                      current.kind === "inpainting" ? change(current) : current,
                    )
                  }
                />
              )}
              {operation.kind === "imageToImage" && (
                <ImageToImageSettings
                  operation={operation}
                  capabilities={capabilities}
                  estimate={estimate}
                  feedback={feedback}
                  updateOperation={updateOperation}
                />
              )}
              {operation.kind === "upscale" && (
                <UpscaleSettings
                  operation={operation}
                  models={models}
                  options={options}
                  optionsError={optionsError}
                  retryOptions={retryOptions}
                  feedback={feedback}
                  updateOperation={updateOperation}
                />
              )}
            </MediaInputSettings>
          </MediaInputLayout>
        )}
        {operation.kind === "inpainting" && <AppliedMaskInput mask={mask} feedback={feedback} />}
        <ImagePickerDialog
          open={pickerOpen}
          onClose={() => {
            setPickerOpen(false);
            setImportAction(null);
          }}
          onSelect={(asset) => {
            setPickerOpen(false);
            requestSource(asset);
          }}
          onRestore={(next) => {
            setImportAction(null);
            onRestore(next);
          }}
        />
        {metadataAsset && (
          <ImageMetadataDialog
            asset={metadataAsset}
            onClose={() => setMetadataAsset(null)}
            onRestore={(next) => {
              setImportAction(null);
              onRestore(next);
            }}
          />
        )}
      </section>
    </Popover.Root>
  );
}
