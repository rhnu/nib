import { Col, Button, Modal, ButtonGroup } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";

import { operationLabel, operationSourceId } from "@/features/inputs/image-operation";
import { PngTextDialog } from "@/features/png-text";
import { VibeEncoderPanel } from "@/features/vibes/vibe-encoder-panel";
import { useWorkbenchContext } from "@/features/workbench/workbench-context";

/** Shared transitions remain available even if the current page cannot render. */
export function WorkspaceDialogs() {
  useTranslation();

  const {
    state,
    pngAsset,
    setPngAsset,
    afterInputs,
    requestOperation,
    encoderOpen,
    setEncoderOpen,
    extension,
    quoteRefreshKey,
    imageOperation,
    pendingInputs,
    mask,
  } = useWorkbenchContext();
  const { draft, readCurrentDraft, edit } = state;
  return (
    <>
      {pngAsset && (
        <PngTextDialog
          asset={pngAsset}
          readState={() => readCurrentDraft().pngTextEditor}
          onChange={(pngTextEditor) => edit({ ...readCurrentDraft(), pngTextEditor })}
          onClose={() => afterInputs(() => setPngAsset(null))}
          onUseImage={(asset) => {
            setPngAsset(null);
            requestOperation(asset.id, "imageToImage");
          }}
        />
      )}
      <Modal
        open={encoderOpen}
        onClose={() => afterInputs(() => setEncoderOpen(false))}
        title={t("app.encodeVibe")}
        className="vibe-encoder-modal [&_>_.modal-header]:p-[12px_16px] [&_>_.modal-header]:m-0 [&_>_.modal-header]:[border-bottom:1px_solid_var(--line-subtle)]"
      >
        <VibeEncoderPanel
          onAddReference={extension.onAddVibeReference}
          draft={draft}
          readCurrentDraft={readCurrentDraft}
          refreshKey={quoteRefreshKey}
          onChange={(vibeEncoder) => edit({ ...readCurrentDraft(), vibeEncoder })}
        />
      </Modal>
      {(imageOperation.busy || pendingInputs > 0) && (
        <output className="generation-muted text-muted image-operation-progress absolute bottom-[10px] right-[12px] p-[var(--space-2)_10px] bg-panel [border:1px_solid_var(--line)] rounded-control">
          {t("app.preparingInputs")}
        </output>
      )}
      <Modal
        open={imageOperation.candidate !== null}
        onClose={imageOperation.cancel}
        title={t("app.changeOperationTitle")}
      >
        {imageOperation.candidate && (
          <Col
            gap={0}
            className="generation-dialog-body flex flex-col gap-space-4 p-0 overflow-auto"
          >
            <p>
              {t("app.switchImageOperation", {
                operation: operationLabel(imageOperation.candidate.operation),
              })}
            </p>
            {imageOperation.candidate.operation.kind === "imageToImage" &&
              imageOperation.candidate.operation.maxEnhance && <p>{t("app.useSourceSize")}</p>}
            <ButtonGroup
              gap={0}
              justify="end"
              as="footer"
              className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
            >
              <Button onClick={imageOperation.cancel}>{t("app.keepOperation")}</Button>
              <Button
                variant="primary"

                onClick={() => afterInputs(imageOperation.confirm)}
              >
                {t("app.applyChanges")}
              </Button>
            </ButtonGroup>
          </Col>
        )}
      </Modal>
      <Modal open={mask.transition !== null} onClose={mask.cancel} title={t("app.maskNotApplied")}>
        <Col gap={0} className="generation-dialog-body flex flex-col gap-space-4 p-0 overflow-auto">
          <p>{t("app.keepMaskHelp")}</p>
          <ButtonGroup
            gap={0}
            justify="end"
            as="footer"
            className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
          >
            <Button disabled={mask.pending} onClick={mask.cancel}>
              {t("app.cancel")}
            </Button>
            <Button disabled={mask.pending} onClick={mask.discardAndContinue}>
              {t("app.discardEdits")}
            </Button>
            <Button disabled={mask.pending} onClick={mask.keep}>
              {t("app.keepEdits")}
            </Button>
            <Button
              variant="primary"
              disabled={mask.pending}
              onClick={() => {
                void mask.applyAndContinue();
              }}
            >
              {mask.pending ? t("app.applying") : t("app.applyMask")}
            </Button>
          </ButtonGroup>
        </Col>
      </Modal>
      <Modal
        open={mask.applyConfirmation !== null}
        onClose={() => mask.confirmApply(false)}
        title={t("app.switchToInpaintTitle")}
      >
        <Col gap={0} className="generation-dialog-body flex flex-col gap-space-4 p-0 overflow-auto">
          <p>
            {mask.applyConfirmation &&
              t(
                operationSourceId(mask.applyConfirmation.operation) !== mask.active?.sourceAssetId
                  ? "app.replaceOperationSource"
                  : "app.replaceOperationParameters",
                { operation: operationLabel(mask.applyConfirmation.operation) },
              )}
          </p>
          <ButtonGroup
            gap={0}
            justify="end"
            as="footer"
            className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
          >
            <Button onClick={() => mask.confirmApply(false)}>{t("app.cancel")}</Button>
            <Button variant="primary" onClick={() => mask.confirmApply(true)}>
              {t("app.applyMaskAndSwitch")}
            </Button>
          </ButtonGroup>
        </Col>
      </Modal>
      <Modal open={mask.discarding} onClose={mask.cancelDiscard} title={t("app.discardMaskTitle")}>
        <Col gap={0} className="generation-dialog-body flex flex-col gap-space-4 p-0 overflow-auto">
          <ButtonGroup
            gap={0}
            justify="end"
            as="footer"
            className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
          >
            <Button onClick={mask.cancelDiscard}>{t("app.cancel")}</Button>
            <Button variant="primary" onClick={mask.confirmDiscard}>
              {t("app.discardEdits")}
            </Button>
          </ButtonGroup>
        </Col>
      </Modal>
    </>
  );
}
