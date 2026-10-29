import { useAccount } from "../generation/account/account-context";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  DirectorToolKind,
  DirectorToolState,
  DirectorWorkspace as DirectorWorkspaceState,
  Draft,
} from "../../bindings/workbench";
import { Button, Modal, Notice } from "../../shared/ui";
import { ImageImporter, ImagePickerDialog, useMediaAsset } from "../media";
import { imageName } from "../media/model";
import { ImageMetadataDialog } from "../media/ImageMetadataDialog";
import { GenerationActions } from "../generation/submission/GenerationActions";
import { JobQueue } from "../generation/jobs/JobQueue";
import { useGenerationQuote } from "../generation/submission/use-generation-quote";
import type { ImageOperationAction } from "../inputs/image-operation";
import { DirectorParameters } from "./DirectorParameters";
import { DirectorResults } from "./DirectorResults";
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
      (target?.querySelector<HTMLElement>("textarea, input, select, button") ?? target)?.focus();
    });
  };
  if (!state) return <Notice>导演工具工作态不可用，请重新打开应用。</Notice>;
  return (
    <div className={`director-workspace director-mobile-${mobileView}`} ref={root}>
      <nav className="director-mobile-navigation" aria-label="导演工具视图">
        <Button aria-pressed={mobileView === "input"} onClick={() => setMobileView("input")}>
          输入与参数
        </Button>
        <Button aria-pressed={mobileView === "results"} onClick={() => setMobileView("results")}>
          结果
        </Button>
      </nav>
      <div className="director-body">
        <aside className="director-sidebar" aria-label="导演工具输入与参数">
          <div className="director-sidebar-scroll">
            <section className="director-tool-section">
              <h2>工具</h2>
              <div className="director-tool-picker" role="radiogroup" aria-label="选择导演工具">
                {workspace.tools.map((item) => (
                  <label key={item.tool} className={item.tool === state.tool ? "is-selected" : ""}>
                    <input
                      type="radio"
                      name="director-tool"
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
              <h2>输入</h2>
              <div data-director-field="assetId">
                <ImageImporter
                  key={state.tool}
                  label={state.assetId ? "更换图片" : "选择文件"}
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
                    图片信息
                  </Button>
                </div>
              )}
              {media.loading && <output className="muted">正在读取输入…</output>}
              {media.error && (
                <Notice actions={<Button onClick={media.retry}>重试读取</Button>}>
                  {media.error}
                </Notice>
              )}
              {!state.assetId && <p className="muted">未选择输入图片</p>}
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
                选择输入图片后提交
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
        title="导演工具输入"
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
          title={`替换${directorToolLabels[candidate.tool]}输入？`}
          onClose={() => {
            completeHandoff(candidate.handoffId);
            setCandidate(null);
          }}
        >
          <div className="director-replace-dialog">
            <p>当前输入将替换为所选图片。此工具的参数与已有输出继续保留。</p>
            <div className="director-dialog-actions">
              <Button
                onClick={() => {
                  completeHandoff(candidate.handoffId);
                  setCandidate(null);
                }}
              >
                保留当前输入
              </Button>
              <Button className="primary" onClick={() => accept(candidate)}>
                替换输入
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
