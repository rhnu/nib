import { Button, Modal } from "@/shared/ui";
import { operationLabel, operationSourceId } from "@/features/inputs/image-operation";
import { PngTextDialog } from "@/features/png-text";
import { VibeEncoderPanel } from "@/features/vibes/vibe-encoder-panel";
import { useWorkbenchContext } from "@/features/workbench/workbench-context";

/** Shared transitions remain available even if the current page cannot render. */
export function WorkspaceDialogs() {
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
        title="编码氛围转移"
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
        <output className="generation-muted image-operation-progress">正在准备图像输入…</output>
      )}
      <Modal
        open={imageOperation.candidate !== null}
        onClose={imageOperation.cancel}
        title="更改当前图像操作？"
      >
        {imageOperation.candidate && (
          <div className="generation-dialog-body">
            <p>
              将切换到{operationLabel(imageOperation.candidate.operation)}
              ，替换当前图像操作。
            </p>
            {imageOperation.candidate.operation.kind === "imageToImage" &&
              imageOperation.candidate.operation.maxEnhance && <p>输入尺寸将采用源图尺寸。</p>}
            <footer className="generation-dialog-actions">
              <Button onClick={imageOperation.cancel}>保留当前操作</Button>
              <Button className="primary" onClick={() => afterInputs(imageOperation.confirm)}>
                应用更改
              </Button>
            </footer>
          </div>
        )}
      </Modal>
      <Modal open={mask.transition !== null} onClose={mask.cancel} title="遮罩尚未应用">
        <div className="generation-dialog-body">
          <p>保留编辑可在下次打开这张源图时继续。</p>
          <footer className="generation-dialog-actions">
            <Button disabled={mask.pending} onClick={mask.cancel}>
              取消
            </Button>
            <Button disabled={mask.pending} onClick={mask.discardAndContinue}>
              放弃编辑
            </Button>
            <Button disabled={mask.pending} onClick={mask.keep}>
              保留编辑
            </Button>
            <Button
              className="primary"
              disabled={mask.pending}
              onClick={() => {
                void mask.applyAndContinue();
              }}
            >
              {mask.pending ? "正在应用…" : "应用遮罩"}
            </Button>
          </footer>
        </div>
      </Modal>
      <Modal
        open={mask.applyConfirmation !== null}
        onClose={() => mask.confirmApply(false)}
        title="切换为局部重绘？"
      >
        <div className="generation-dialog-body">
          <p>
            将替换当前
            {mask.applyConfirmation && operationLabel(mask.applyConfirmation.operation)}
            {mask.applyConfirmation &&
            operationSourceId(mask.applyConfirmation.operation) !== mask.active?.sourceAssetId
              ? "的源图与专有参数。"
              : "的专有参数。"}
          </p>
          <footer className="generation-dialog-actions">
            <Button onClick={() => mask.confirmApply(false)}>取消</Button>
            <Button className="primary" onClick={() => mask.confirmApply(true)}>
              应用遮罩并切换
            </Button>
          </footer>
        </div>
      </Modal>
      <Modal open={mask.discarding} onClose={mask.cancelDiscard} title="放弃未应用的遮罩编辑？">
        <div className="generation-dialog-body">
          <footer className="generation-dialog-actions">
            <Button onClick={mask.cancelDiscard}>取消</Button>
            <Button className="primary" onClick={mask.confirmDiscard}>
              放弃编辑
            </Button>
          </footer>
        </div>
      </Modal>
    </>
  );
}
