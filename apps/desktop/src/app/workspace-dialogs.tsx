import { t, useTranslation } from "@/shared/i18n";
import { Button, Modal } from "@/shared/ui";
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
        className="vibe-encoder-modal"
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
        <output className="generation-muted image-operation-progress">
          {t("app.preparingInputs")}
        </output>
      )}
      <Modal
        open={imageOperation.candidate !== null}
        onClose={imageOperation.cancel}
        title={t("app.changeOperationTitle")}
      >
        {imageOperation.candidate && (
          <div className="generation-dialog-body">
            <p>
              {t("app.switchImageOperation", {
                operation: operationLabel(imageOperation.candidate.operation),
              })}
            </p>
            {imageOperation.candidate.operation.kind === "imageToImage" &&
              imageOperation.candidate.operation.maxEnhance && <p>{t("app.useSourceSize")}</p>}
            <footer className="ui-actions">
              <Button onClick={imageOperation.cancel}>{t("app.keepOperation")}</Button>
              <Button className="primary" onClick={() => afterInputs(imageOperation.confirm)}>
                {t("app.applyChanges")}
              </Button>
            </footer>
          </div>
        )}
      </Modal>
      <Modal open={mask.transition !== null} onClose={mask.cancel} title={t("app.maskNotApplied")}>
        <div className="generation-dialog-body">
          <p>{t("app.keepMaskHelp")}</p>
          <footer className="ui-actions">
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
              className="primary"
              disabled={mask.pending}
              onClick={() => {
                void mask.applyAndContinue();
              }}
            >
              {mask.pending ? t("app.applying") : t("app.applyMask")}
            </Button>
          </footer>
        </div>
      </Modal>
      <Modal
        open={mask.applyConfirmation !== null}
        onClose={() => mask.confirmApply(false)}
        title={t("app.switchToInpaintTitle")}
      >
        <div className="generation-dialog-body">
          <p>
            {mask.applyConfirmation &&
              t(
                operationSourceId(mask.applyConfirmation.operation) !== mask.active?.sourceAssetId
                  ? "app.replaceOperationSource"
                  : "app.replaceOperationParameters",
                { operation: operationLabel(mask.applyConfirmation.operation) },
              )}
          </p>
          <footer className="ui-actions">
            <Button onClick={() => mask.confirmApply(false)}>{t("app.cancel")}</Button>
            <Button className="primary" onClick={() => mask.confirmApply(true)}>
              {t("app.applyMaskAndSwitch")}
            </Button>
          </footer>
        </div>
      </Modal>
      <Modal open={mask.discarding} onClose={mask.cancelDiscard} title={t("app.discardMaskTitle")}>
        <div className="generation-dialog-body">
          <footer className="ui-actions">
            <Button onClick={mask.cancelDiscard}>{t("app.cancel")}</Button>
            <Button className="primary" onClick={mask.confirmDiscard}>
              {t("app.discardEdits")}
            </Button>
          </footer>
        </div>
      </Modal>
    </>
  );
}
