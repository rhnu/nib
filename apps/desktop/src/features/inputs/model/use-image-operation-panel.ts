import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { GenerationQuote, ParameterDiagnostic } from "@/bindings/generation";
import type { MediaAsset } from "@/bindings/media";
import type { CreationOperation, Draft, ModelCapabilities } from "@/bindings/workbench";
import { errorMessage } from "@/shared/host/error";
import { useMediaAsset } from "@/features/media/use-media-asset";
import {
  imageOperationAction,
  imageOperationApi,
  operationSourceId,
  type ImageOperationAction,
} from "../image-operation";

export interface ImageOperationPanelProps {
  draft: Draft;
  capabilities: ModelCapabilities | null;
  estimate: GenerationQuote | null;
  diagnostics?: ParameterDiagnostic[];
  errorFields?: string[];
  models: string[];
  readCurrentDraft: () => Draft;
  edit: (draft: Draft) => void;
  onRestore: (draft: Draft) => void;
  onError: (message: string) => void;
  onRequestOperation: (id: string, kind: ImageOperationAction) => void;
  onPrepareImportedOperation: (id: string, kind: ImageOperationAction) => Promise<void>;
  onReturnToText: () => void;
  inputVersion: number;
  onEditMask: (assetId: string) => void;
}

/** Owns pending source selection and updates against the latest matching operation. */
export function useImageOperationPanel({
  draft,
  readCurrentDraft,
  edit,
  onError,
  onRequestOperation,
  onPrepareImportedOperation,
  onReturnToText,
  onEditMask,
}: ImageOperationPanelProps) {
  const operation = draft.inputs.operation;
  const currentAction =
    operation.kind === "inpainting" ? "inpainting" : imageOperationAction(operation);
  const [importAction, setImportAction] = useState<ImageOperationAction | "inpainting" | null>(
    null,
  );
  const action = currentAction === "textToImage" ? (importAction ?? currentAction) : currentAction;
  const sourceId = operationSourceId(operation);
  const media = useMediaAsset(sourceId);
  const mask = useMediaAsset(operation.kind === "inpainting" ? operation.maskAssetId : null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [metadataAsset, setMetadataAsset] = useState<MediaAsset | null>(null);
  const optionsQuery = useQuery({
    queryKey: ["model", "image-operation-options"],
    queryFn: imageOperationApi.options,
    staleTime: Infinity,
  });
  const options = optionsQuery.data ?? null;
  const optionsError = optionsQuery.error ? errorMessage(optionsQuery.error) : null;

  const requestSource = (asset: MediaAsset) => {
    if (action === "inpainting") onEditMask(asset.id);
    else {
      const target = action === "upscale" || action === "maxEnhance" ? action : "imageToImage";
      onRequestOperation(asset.id, target);
    }
    setImportAction(null);
  };

  const prepareImportedSource = async (asset: MediaAsset) => {
    const target =
      action === "inpainting" || action === "upscale" || action === "maxEnhance"
        ? action
        : "imageToImage";
    // This callback is already inside tracked import work, so it cannot wait for global work.
    await onPrepareImportedOperation(asset.id, target);
    setImportAction(null);
  };

  const selectAction = (next: string) => {
    if (next === "textToImage") {
      setImportAction(null);
      onReturnToText();
    } else if (next === "inpainting") {
      if (sourceId) onEditMask(sourceId);
      else {
        setImportAction(next);
        setPickerOpen(true);
      }
    } else if (next === "imageToImage" || next === "maxEnhance" || next === "upscale") {
      if (sourceId) onRequestOperation(sourceId, next);
      else {
        setImportAction(next);
        setPickerOpen(true);
      }
    }
  };

  const updateOperation = (update: (value: CreationOperation) => CreationOperation) => {
    const current = readCurrentDraft();
    if (
      current.inputs.operation.kind !== operation.kind ||
      operationSourceId(current.inputs.operation) !== sourceId
    ) {
      onError("图像操作已改变，请在当前操作中重新编辑。");
      return;
    }
    edit({
      ...current,
      inputs: { ...current.inputs, operation: update(current.inputs.operation) },
    });
  };

  return {
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
    retryOptions: () => {
      void optionsQuery.refetch();
    },
    requestSource,
    prepareImportedSource,
    selectAction,
    updateOperation,
  };
}
