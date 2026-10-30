import { deferMessage, t, MessageError } from "@/shared/i18n";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MediaAsset } from "@/bindings/media";
import type {
  Draft,
  Resource,
  VibeEncodingInput,
  VibeReferenceInput,
  WorkspaceSnapshot,
} from "@/bindings/workbench";
import { trackPendingWork, usePendingWork, waitForPendingWork } from "@/shared/host/pending-work";
import type { CloseWriter } from "@/shared/host/use-close-guard";
import { useWorkbench } from "./use-workbench";
import { useModelCapabilities } from "@/features/model/use-model-capabilities";
import { useImageOperationRequest } from "@/features/inputs/use-image-operation-request";
import { type ImageOperationAction } from "@/features/inputs/image-operation";
import { useAccount } from "@/features/generation/account/account-context";
import { useGenerationQuote } from "@/features/generation/submission/use-generation-quote";
import { isQuoteEligible } from "@/features/generation/submission/quote-state";
import { useMaskEditor } from "./use-mask-editor";
import { characterKey, livePositionCharacters } from "@/features/positioning/model";
import { outputIdentity } from "@/features/prompt/output-identity";
import { collectOutputIssues, focusOutputField } from "./output-issues";
import { usePendingInputTransition } from "./use-pending-input-transition";
import { encodingApi } from "@/features/vibes/encoding-api";
import { mediaApi } from "@/features/media/api";
import { referenceApi } from "@/features/references/api";
import { canLeaveWorkbench } from "./navigation-guard";

export type WorkbenchControllerOptions = {
  workspace: WorkspaceSnapshot;
  initialResources: Map<string, Resource>;
  settingsWriter: CloseWriter;
  page: Draft["activePage"];
  navigate: (page: Draft["activePage"], alreadyGuarded?: boolean) => Promise<void>;
  readOnly: boolean;
  recentImageLimit: number;
  renderSettings: (context: {
    beforeMigrate: () => Promise<void>;
    onOpenTasks: () => void;
  }) => ReactNode;
};

/** Long-lived edit and operation coordination, independent of routed page lifetimes. */
export function useWorkbenchController(options: WorkbenchControllerOptions) {
  const { workspace, initialResources, settingsWriter, page, navigate, readOnly } = options;
  const state = useWorkbench(workspace, initialResources, settingsWriter, navigate);
  const {
    setBeforeClose,
    draft,
    generationDraft,
    resources,
    resolved,
    resolving,
    resolveError,
    setError,
    edit,
    restore,
    restoreVersion,
    readCurrentDraft,
    openLibrary,
    resourceVersion,
  } = state;
  const { accountVersion, accountSummaryLoading } = useAccount();
  const [positioning, setPositioning] = useState<{ selected: string | null } | null>(null);
  const [viewedAssetId, setViewedAssetId] = useState<string | null>(null);
  const [encoderOpen, setEncoderOpen] = useState(false);
  const [pngAsset, setPngAsset] = useState<MediaAsset | null>(null);
  const [directorHandoff, setDirectorHandoff] = useState<{ id: number; assetId: string } | null>(
    null,
  );
  const handoffSequence = useRef(0);
  const quoteRefreshKey = [resourceVersion, accountVersion];
  const estimate = useGenerationQuote(
    generationDraft,
    quoteRefreshKey,
    !resolving && !accountSummaryLoading && isQuoteEligible(draft, resolved),
  );
  const model = {
    capabilities: state.capabilities,
    error: resolveError,
    retry: state.retryResolution,
  };
  const generationTarget = useModelCapabilities(
    draft.settings.model ?? resolved?.settings.model ?? workspace.info.defaultModelId,
    resolved?.settings ?? draft.settings,
    draft.inputs.operation.kind === "upscale" || positioning !== null,
  );
  const baseEditorCapabilities =
    model.capabilities ??
    (draft.inputs.operation.kind === "upscale" ? generationTarget.capabilities : null);
  const editorCapabilities =
    baseEditorCapabilities && estimate.quote?.sampleLimit
      ? {
          ...baseEditorCapabilities,
          ranges: {
            ...baseEditorCapabilities.ranges,
            nSamples: {
              ...baseEditorCapabilities.ranges.nSamples,
              max: estimate.quote.sampleLimit,
            },
          },
        }
      : baseEditorCapabilities;
  const imageOperation = useImageOperationRequest({
    readCurrentDraft,
    edit,
    onError: setError,
    contextVersion: restoreVersion,
  });

  // Domain handoffs below already finish pending work and resolve the mask decision.
  const setPage = (target: Draft["activePage"]) => navigate(target, true);

  const mask = useMaskEditor({ draft, readCurrentDraft, edit, onError: setError });
  const pendingInputs = usePendingWork();
  const afterInputs = usePendingInputTransition(setError);

  const guard = (action: () => void) => afterInputs(() => mask.guard(action));

  const openEncoder = (input?: VibeEncodingInput) =>
    afterInputs(() => {
      if (input) edit({ ...readCurrentDraft(), vibeEncoder: input });
      setEncoderOpen(true);
    });

  useLayoutEffect(() => {
    setBeforeClose(async () => {
      await waitForPendingWork();
      return readOnly || mask.requestClose();
    });
  });

  const editMask = (id: string) => {
    afterInputs(() => {
      imageOperation.cancel();
      setPositioning(null);
      mask.open(id);
    });
  };

  const requestOperation = (id: string, kind: ImageOperationAction) => {
    if (kind === "inpainting") {
      afterInputs(() => {
        imageOperation.cancel();
        setPositioning(null);
        mask.open(id, () => {
          void setPage("create");
        });
      });
    } else
      guard(() => {
        setPositioning(null);
        setPage("create");
        void imageOperation.request(id, kind).catch(() => {});
      });
  };

  const prepareImportedOperation = async (id: string, kind: ImageOperationAction) => {
    let preparation: Promise<void> | undefined;
    // Import already owns pending work. Only the local mask decision may precede this commit.
    if (kind === "inpainting") {
      mask.open(id, () => {
        imageOperation.cancel();
        setPositioning(null);
        void setPage("create");
      });
    } else
      mask.guard(() => {
        setPositioning(null);
        setPage("create");
        preparation = imageOperation.request(id, kind);
        // A mask decision may defer this callback beyond the import's await.
        // The request reports failures itself; also handle rejection in that case.
        void preparation.catch(() => {});
      });
    await preparation;
  };

  const guardedRestore = (value: Draft) =>
    guard(() => {
      setPositioning(null);
      if (value.activePage === "director") {
        const incoming = value.director.tools.find(
          (tool) => tool.tool === value.director.selectedTool,
        );
        const current = readCurrentDraft();
        edit({
          ...current,
          director: {
            ...current.director,
            selectedTool: value.director.selectedTool,
            tools: current.director.tools.map((tool) =>
              tool.tool === incoming?.tool ? incoming : tool,
            ),
          },
        });
      } else restore(value);
      setPage(value.activePage);
    });

  const sendToDirector = (assetId: string) =>
    guard(() => {
      setDirectorHandoff({ id: ++handoffSequence.current, assetId });
      setPage("director");
    });

  const addImageReference = (assetId: string, kind: "precise" | "vibe") =>
    guard(() => {
      void trackPendingWork(
        (async () => {
          const referenceType = editorCapabilities?.preciseReferenceOptions.referenceTypes[0];
          if (kind === "precise" && !referenceType)
            throw new MessageError(deferMessage(() => t("workbench.preciseReferenceUnsupported")));
          const reference =
            kind === "vibe"
              ? await mediaApi.createVibeReference(assetId)
              : await referenceApi.create(assetId, crypto.randomUUID(), referenceType!);
          const current = readCurrentDraft();
          const references = current.inputs.references;
          edit({
            ...current,
            inputs: {
              ...current.inputs,
              references:
                kind === "vibe"
                  ? { ...references, vibes: [...references.vibes, reference as VibeReferenceInput] }
                  : {
                      ...references,
                      precise: [
                        ...references.precise,
                        reference as (typeof references.precise)[number],
                      ],
                    },
            },
          });
          setPage("create");
        })(),
      ).catch((cause: unknown) => setError(cause));
    });

  const encodeImage = (assetId: string) =>
    afterInputs(() => {
      void trackPendingWork(
        (async () => {
          const options = await encodingApi.options();
          const previous = readCurrentDraft().vibeEncoder;
          const model = previous?.model ?? options.models[0];
          if (!model)
            throw new MessageError(deferMessage(() => t("workbench.noVibeEncodingModel")));
          const created = await encodingApi.create(assetId, model);
          const current = readCurrentDraft();
          edit({
            ...current,
            vibeEncoder: current.vibeEncoder ? { ...current.vibeEncoder, assetId } : created,
          });
          setEncoderOpen(true);
        })(),
      ).catch((cause: unknown) => setError(cause));
    });

  const guardedLibrary = (target: Parameters<typeof openLibrary>[0]) =>
    guard(() => {
      openLibrary(target);
      setPage("library");
    });

  const focusField = (field: string) => {
    focusOutputField(field, readCurrentDraft(), resources, resolved);
  };

  const openPositions = (id?: string, instanceId?: string) =>
    guard(() => {
      imageOperation.cancel();
      setPositioning({
        selected: id
          ? characterKey({
              presetInstanceId: instanceId ?? null,
              id: outputIdentity(instanceId ?? null, id),
            })
          : null,
      });
      setPage("create");
    });

  const positionCharacters = livePositionCharacters(draft, resources, resolved?.characters ?? []);
  const positionSize =
    draft.settings.size ?? resolved?.settings.size ?? generationTarget.capabilities?.defaults.size;
  const outputIssues = collectOutputIssues(
    draft,
    resources,
    resolved,
    estimate.quote?.diagnostics ?? [],
    estimate.fields,
  );
  const extension = {
    draft,
    readCurrentDraft,
    onRestore: guardedRestore,
    reportError: setError,
    resourceVersion,
    resolved,
    resolving,
    estimate,
    quoteRefreshKey,
    onFocusField: focusField,
    onViewedAssetChange: setViewedAssetId,
    onEncodeVibe: openEncoder,
    onAddVibeReference: (reference: VibeReferenceInput) => {
      const current = readCurrentDraft();
      edit({
        ...current,
        inputs: {
          ...current.inputs,
          references: {
            ...current.inputs.references,
            vibes: [...current.inputs.references.vibes, reference],
          },
        },
      });
    },
    onImageOperation: requestOperation,
    canMaxEnhance: editorCapabilities?.maxEnhance ?? false,
    canInpaint: editorCapabilities?.inpainting ?? false,
    operationPending:
      pendingInputs > 0 ||
      imageOperation.busy ||
      mask.pending ||
      Boolean(
        mask.active &&
        (mask.active.revision !== mask.active.appliedRevision ||
          draft.inputs.operation.kind !== "inpainting" ||
          draft.inputs.operation.assetId !== mask.active.sourceAssetId ||
          draft.inputs.operation.maskAssetId !== mask.active.appliedMaskAssetId),
      ),
  };

  const guardNavigation = async () => {
    try {
      return await canLeaveWorkbench({
        readOnly,
        waitForInputs: waitForPendingWork,
        confirmMask: () =>
          new Promise<boolean>((resolve) =>
            mask.guard(() => resolve(true), { cancel: () => resolve(false) }),
          ),
      });
    } catch (cause) {
      setError(cause);
      return false;
    }
  };

  return {
    options,
    workspace,
    state,
    page,
    setPage,
    model,
    editorCapabilities,
    estimate,
    guardedLibrary,
    focusField,
    openPositions,
    outputIssues,
    guardedRestore,
    requestOperation,
    prepareImportedOperation,
    guard,
    guardNavigation,
    imageOperation,
    editMask,
    extension,
    mask,
    positioning,
    positionSize,
    positionCharacters,
    generationTarget,
    viewedAssetId,
    setPositioning,
    quoteRefreshKey,
    pngAsset,
    setPngAsset,
    afterInputs,
    encoderOpen,
    setEncoderOpen,
    pendingInputs,
    directorHandoff,
    setDirectorHandoff,
    sendToDirector,
    addImageReference,
    encodeImage,
  };
}
