import { t, useTranslation } from "@/shared/i18n";
import { useAccount } from "@/features/generation/account/account-context";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  DirectorToolKind,
  DirectorToolState,
  DirectorWorkspace as DirectorWorkspaceState,
  Draft,
} from "@/bindings/workbench";
import { Button, Modal, Notice } from "@/shared/ui";
import { ImageImporter, ImagePickerDialog, useMediaAsset } from "@/features/media";
import { imageName } from "@/features/media/model";
import { ImageMetadataDialog } from "@/features/media/image-metadata-dialog";
import { GenerationActions } from "@/features/generation/submission/generation-actions";
import { JobQueue } from "@/features/generation/jobs/job-queue";
import { useGenerationQuote } from "@/features/generation/submission/use-generation-quote";
import type { ImageOperationAction } from "@/features/inputs/image-operation";
import { DirectorParameters } from "./director-parameters";
import { DirectorResults } from "./director-results";
import {
  directorSubmission,
  directorToolSubmission,
  directorToolLabels,
  selectedDirectorTool,
  updateDirectorTool,
} from "./model";
import "./director.css";

type SourceCandidate = {
  tool: DirectorToolKind;
  assetId: string;
  handoffId?: number;
  selectTool?: boolean;
};
type Handoff = { id: number; assetId: string };

export function DirectorWorkspace({
  draft,
  readCurrentDraft,
  onChange,
  refreshKey,
  onUseImage,
  onReference,
  onEncodeImage,
  onRestore,
  handoff = null,
  onHandoffComplete,
  canMaxEnhance = false,
  canInpaint = false,
  canUsePreciseReference = false,
  canUseVibeReference = false,
}: {
  draft: Draft;
  readCurrentDraft: () => Draft;
  onChange: (workspace: DirectorWorkspaceState) => void;
  refreshKey: unknown;
  onUseImage: (id: string, kind: ImageOperationAction) => void;
  onReference: (id: string, kind: "precise" | "vibe") => void;
  onEncodeImage: (assetId: string) => void;
  onRestore: (draft: Draft) => void;
  handoff?: Handoff | null;
  onHandoffComplete?: () => void;
  canMaxEnhance?: boolean;
  canInpaint?: boolean;
  canUsePreciseReference?: boolean;
  canUseVibeReference?: boolean;
}) {
  useTranslation();

  const workspace = draft.director;
  const state = selectedDirectorTool(workspace);
  const media = useMediaAsset(state?.assetId ?? null);
  const { accountSummaryLoading } = useAccount();
  const assetId = state?.assetId ?? null;
  const command = state?.command;
  const policy = state?.policy;
  // Result selection and draft saves do not change this independent operation's estimate.
  const submission = useMemo(
    () => directorToolSubmission(assetId, command, policy),
    [assetId, command, policy],
  );
  const estimate = useGenerationQuote(
    submission ?? draft,
    refreshKey,
    Boolean(submission) && !accountSummaryLoading,
  );
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [picker, setPicker] = useState<DirectorToolKind | null>(null);
  const [candidate, setCandidate] = useState<SourceCandidate | null>(null);
  const [mobileView, setMobileView] = useState<"input" | "results">("input");
  const advanced = useRef<HTMLDetailsElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({
    readCurrentDraft,
    onChange,
    onHandoffComplete,
    handoff,
  });
  useLayoutEffect(() => {
    Object.assign(latest.current, {
      readCurrentDraft,
      onChange,
      onHandoffComplete,
      handoff,
    });
  });

  const update = (tool: DirectorToolKind, patch: Partial<DirectorToolState>) => {
    const current = latest.current;
    current.onChange(updateDirectorTool(current.readCurrentDraft().director, tool, patch));
  };

  const completeHandoff = (id?: number) => {
    const current = latest.current;
    if (id !== undefined && current.handoff?.id === id) current.onHandoffComplete?.();
  };

  const accept = (next: SourceCandidate) => {
    const current = latest.current;
    const workspace = updateDirectorTool(current.readCurrentDraft().director, next.tool, {
      assetId: next.assetId,
    });
    current.onChange(next.selectTool ? { ...workspace, selectedTool: next.tool } : workspace);
    setCandidate(null);
    completeHandoff(next.handoffId);
  };

  const requestSource = (next: SourceCandidate) => {
    const saved = latest.current
      .readCurrentDraft()
      .director.tools.find((tool) => tool.tool === next.tool);
    if (saved?.assetId && saved.assetId !== next.assetId) setCandidate(next);
    else accept(next);
  };

  useEffect(() => {
    const current = latest.current;
    if (!current.handoff) return;
    const target = current.readCurrentDraft().director.selectedTool;
    const next = { tool: target, assetId: current.handoff.assetId, handoffId: current.handoff.id };
    const saved = current.readCurrentDraft().director.tools.find((tool) => tool.tool === target);
    if (saved?.assetId && saved.assetId !== next.assetId) setCandidate(next);
    else {
      current.onChange(
        updateDirectorTool(current.readCurrentDraft().director, target, { assetId: next.assetId }),
      );
      current.onHandoffComplete?.();
    }
  }, [handoff?.id]);

  const locate = (field: string) => {
    setMobileView("input");
    const name = field.includes("prompt")
      ? "prompt"
      : field.includes("defry")
        ? "defry"
        : field.includes("policy")
          ? "policy"
          : "assetId";
    if (name === "policy" && advanced.current) advanced.current.open = true;
    requestAnimationFrame(() => {
      const target = root.current?.querySelector<HTMLElement>(`[data-director-field="${name}"]`);
      target?.scrollIntoView({ block: "nearest" });
      (
        target?.querySelector<HTMLElement>(
          '[role="textbox"], textarea, input:not([type="hidden"]), select, button',
        ) ?? target
      )?.focus();
    });
  };

  if (!state) return <Notice>{t("director.stateUnavailable")}</Notice>;
  return (
    <div className={`director-workspace director-mobile-${mobileView}`} ref={root}>
      <nav className="director-mobile-navigation" aria-label={t("director.view")}>
        <Button aria-pressed={mobileView === "input"} onClick={() => setMobileView("input")}>
          {t("director.inputParameters")}
        </Button>
        <Button aria-pressed={mobileView === "results"} onClick={() => setMobileView("results")}>
          {t("director.results")}
        </Button>
      </nav>
      <div className="director-body">
        <aside className="director-sidebar" aria-label={t("director.toolInputParameters")}>
          <div className="director-sidebar-scroll">
            <section className="director-tool-section">
              <h2>{t("director.tool")}</h2>
              <div
                className="director-tool-picker"
                role="radiogroup"
                aria-label={t("director.chooseTool")}
              >
                {workspace.tools.map((item) => (
                  <label key={item.tool} className={item.tool === state.tool ? "is-selected" : ""}>
                    <input
                      type="radio"
                      name={t("director.toolIdentifier")}
                      checked={item.tool === state.tool}
                      onChange={() => {
                        const current = latest.current;
                        current.onChange({
                          ...current.readCurrentDraft().director,
                          selectedTool: item.tool,
                        });
                      }}
                    />
                    <span>{directorToolLabels[item.tool]}</span>
                  </label>
                ))}
              </div>
            </section>
            <section className="director-input-section">
              <h2>{t("director.input")}</h2>
              <div data-director-field="assetId">
                <ImageImporter
                  key={state.tool}
                  label={state.assetId ? t("director.changeImage") : t("director.chooseFile")}
                  onImported={(asset) => requestSource({ tool: state.tool, assetId: asset.id })}
                  onChooseExisting={() => setPicker(state.tool)}
                />
              </div>
              {media.asset && (
                <div className="director-input-metadata">
                  <p>
                    {imageName(media.asset)} · {media.asset.width} × {media.asset.height}
                  </p>
                  <Button className="quiet" onClick={() => setMetadataOpen(true)}>
                    {t("director.imageInfo")}
                  </Button>
                </div>
              )}
              {media.loading && <output className="muted">{t("director.loadingInput")}</output>}
              {media.error && (
                <Notice actions={<Button onClick={media.retry}>{t("director.retryLoad")}</Button>}>
                  {media.error}
                </Notice>
              )}
            </section>
            <section className="director-parameter-section">
              <DirectorParameters
                key={state.tool}
                state={state}
                onChange={(patch) => update(state.tool, patch)}
                advancedRef={advanced}
              />
            </section>
          </div>
          <footer className="director-submit">
            {submission ? (
              <GenerationActions
                draft={submission}
                readCurrentDraft={() =>
                  directorSubmission(readCurrentDraft()) ?? readCurrentDraft()
                }
                refreshKey={refreshKey}
                estimate={estimate}
                operationPending={Boolean(
                  candidate || handoff || media.error || media.loading || !media.asset?.available,
                )}
                onFocusField={locate}
              />
            ) : (
              <Button className="primary" disabled>
                {t("director.selectInputHint")}
              </Button>
            )}
          </footer>
        </aside>
        <main className="director-main">
          <DirectorResults
            key={state.tool}
            tool={state.tool}
            tools={workspace.tools.map((item) => item.tool)}
            sourceId={state.assetId}
            selectedId={state.selectedResultId}
            onSelect={(selectedResultId) => update(state.tool, { selectedResultId })}
            onContinue={(assetId, tool) => requestSource({ tool, assetId, selectTool: true })}
            onUseImage={onUseImage}
            onReference={onReference}
            onEncodeVibe={onEncodeImage}
            onRestore={onRestore}
            canInpaint={canInpaint}
            canMaxEnhance={canMaxEnhance}
            canUsePreciseReference={canUsePreciseReference}
            canUseVibeReference={canUseVibeReference}
          />
          <div className="director-queue-trigger">
            <JobQueue />
          </div>
        </main>
      </div>
      <ImagePickerDialog
        key={picker ?? "closed"}
        open={picker !== null}
        title={t("director.toolInput")}
        onClose={() => setPicker(null)}
        onSelect={(asset) => picker && requestSource({ tool: picker, assetId: asset.id })}
        onRestore={onRestore}
      />
      {metadataOpen && media.asset && (
        <ImageMetadataDialog
          asset={media.asset}
          onClose={() => setMetadataOpen(false)}
          onRestore={onRestore}
        />
      )}
      {candidate && (
        <Modal
          open
          title={t("director.replaceInputTitle", { value0: directorToolLabels[candidate.tool] })}
          onClose={() => {
            completeHandoff(candidate.handoffId);
            setCandidate(null);
          }}
        >
          <div className="director-replace-dialog">
            <p>{t("director.replaceInputHelp")}</p>
            <div className="director-dialog-actions">
              <Button
                onClick={() => {
                  completeHandoff(candidate.handoffId);
                  setCandidate(null);
                }}
              >
                {t("director.keepInput")}
              </Button>
              <Button className="primary" onClick={() => accept(candidate)}>
                {t("director.replaceInput")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
