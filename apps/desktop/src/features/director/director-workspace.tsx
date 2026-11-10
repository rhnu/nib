import { ButtonGroup, Col, Grid, Input, Row, Button, Modal, Notice } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useAccount } from "@/features/generation/account/account-context";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  DirectorToolKind,
  DirectorToolState,
  DirectorWorkspace as DirectorWorkspaceState,
  Draft,
} from "@/bindings/workbench";

import { ImageImporter, ImagePickerDialog, useMediaAsset } from "@/features/media";
import { imageName } from "@/features/media/model";
import { useImageDrop } from "@/features/media/use-image-drop";
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
  inputVersion,
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
  inputVersion: number;
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

  const selectedTool = workspace.selectedTool;
  const drop = useImageDrop({
    onImported: (asset) => requestSource({ tool: selectedTool, assetId: asset.id }),
    contextKey: JSON.stringify([inputVersion, selectedTool, assetId]),
  });

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
      const target = root.current?.querySelector<HTMLElement>(`[data-director-field='${name}']`);
      target?.scrollIntoView({ block: "nearest" });
      (
        target?.querySelector<HTMLElement>(
          "[role='textbox'], textarea, input:not([type='hidden']), select, button",
        ) ?? target
      )?.focus();
    });
  };

  if (!state) return <Notice>{t("director.stateUnavailable")}</Notice>;
  return (
    <Col
      gap={0}
      className={`director-workspace flex flex-1 flex-col min-h-0 overflow-hidden image-drop-page relative director-mobile-${mobileView}`}
      ref={root}
      {...drop.bindings}
    >
      {(drop.dragging || drop.busy) && (
        <output className="page-image-drop absolute inset-[8px] z-20 grid place-content-center [border:2px_dashed_var(--accent)] rounded-control bg-accent-soft text-foreground font-semibold pointer-events-none">
          {t(drop.busy ? "media.importing" : "media.dropHere")}
        </output>
      )}
      {drop.error && (
        <div className="page-image-drop-error absolute top-[8px] right-[12px] z-21 max-w-[420px]">
          <Notice actions={<Button onClick={drop.clearError}>{t("common.close")}</Button>}>
            {drop.error}
          </Notice>
        </div>
      )}
      <nav
        className="director-mobile-navigation max-[760px]:flex max-[760px]:gap-space-2 max-[760px]:p-[var(--space-3)_var(--space-4)] max-[760px]:[border-bottom:1px_solid_var(--line)] hidden"
        aria-label={t("director.view")}
      >
        <Button aria-pressed={mobileView === "input"} onClick={() => setMobileView("input")}>
          {t("director.inputParameters")}
        </Button>
        <Button aria-pressed={mobileView === "results"} onClick={() => setMobileView("results")}>
          {t("director.results")}
        </Button>
      </nav>
      <Grid
        columns={1}
        align="stretch"
        gap={0}
        minColumnWidth="0px"
        className="director-body max-[760px]:flex max-[760px]:overflow-hidden grid flex-1 grid-cols-[var(--sidebar-width)_minmax(0,_1fr)] min-h-0"
      >
        <Col
          as="aside"
          gap={0}
          className="director-sidebar max-[760px]:flex-1 max-[760px]:[border-right:0] max-[760px]:[.director-mobile-results_&]:hidden flex flex-col min-h-0 min-w-0 [border-right:1px_solid_var(--line)] bg-panel"
          aria-label={t("director.toolInputParameters")}
        >
          <div className="director-sidebar-scroll [&_>_section]:p-[var(--space-4)_14px] [&_>_section]:[border-bottom:1px_solid_var(--line-subtle)] flex-1 min-h-0 overflow-auto [scrollbar-gutter:stable]">
            <section className="director-tool-section">
              <h2>{t("director.tool")}</h2>
              <Grid
                columns={1}
                align="stretch"
                gap={0}
                minColumnWidth="0px"
                className="director-tool-picker [&_label]:flex [&_label]:items-center [&_label]:gap-[7px] [&_label]:min-h-control [&_label]:p-[var(--space-2)_var(--space-3)] [&_label]:[border:1px_solid_var(--line)] [&_label]:rounded-control [&_label]:cursor-pointer [&_label]:text-label [&_label:hover]:bg-hover [&_label.is-selected]:text-accent [&_label.is-selected]:border-accent [&_input]:shrink-0 [&_input]:w-[15px] [&_input]:h-[15px] [&_input]:m-0 [&_input]:p-0 [&_input]:accent-accent grid grid-cols-2 gap-space-2 mt-[10px]"
                role="radiogroup"
                aria-label={t("director.chooseTool")}
              >
                {workspace.tools.map((item) => (
                  <label key={item.tool} className={item.tool === state.tool ? "is-selected" : ""}>
                    <Input
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
              </Grid>
            </section>
            <section className="director-input-section [&_>_h2]:mb-[10px]">
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
                <Row
                  gap={0}
                  className="director-input-metadata [&_p]:m-[var(--space-2)_0] [&_p]:wrap-anywhere flex items-center justify-between gap-space-3 text-muted text-caption"
                >
                  <p>
                    {imageName(media.asset)} · {media.asset.width} × {media.asset.height}
                  </p>
                  <Button variant="quiet" className="" onClick={() => setMetadataOpen(true)}>
                    {t("director.imageInfo")}
                  </Button>
                </Row>
              )}
              {media.loading && (
                <output className="muted text-muted">{t("director.loadingInput")}</output>
              )}
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
          <Grid
            align="stretch"
            as="footer"
            gap={0}
            columns={1}
            minColumnWidth="0px"
            className="director-submit grid shrink-0 gap-space-3 p-[10px_14px] [border-top:1px_solid_var(--line)]"
          >
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
              <Button variant="primary" className="" disabled>
                {t("director.selectInputHint")}
              </Button>
            )}
          </Grid>
        </Col>
        <Col
          as="main"
          gap={0}
          className="director-main max-[760px]:[.director-mobile-input_&]:hidden flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden bg-background relative"
        >
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
          <div className="director-queue-trigger absolute top-[8px] right-[8px] z-15">
            <JobQueue />
          </div>
        </Col>
      </Grid>
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
          <Grid
            align="stretch"
            gap={0}
            columns={1}
            minColumnWidth="0px"
            className="director-replace-dialog [&_p]:m-0 grid gap-space-5 p-[18px]"
          >
            <p>{t("director.replaceInputHelp")}</p>
            <ButtonGroup
              gap={0}
              className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
            >
              <Button
                onClick={() => {
                  completeHandoff(candidate.handoffId);
                  setCandidate(null);
                }}
              >
                {t("director.keepInput")}
              </Button>
              <Button variant="primary" className="" onClick={() => accept(candidate)}>
                {t("director.replaceInput")}
              </Button>
            </ButtonGroup>
          </Grid>
        </Modal>
      )}
    </Col>
  );
}
