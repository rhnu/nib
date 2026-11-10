import { Grid } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { PromptTextEditor } from "@/features/prompt/prompt-text-editor";
import type { JobRecord } from "@/bindings/generation";
import { ContentSources, SettingsSources } from "@/features/prompt/resolution-sources";
import { submissionLabel } from "./operation";
import { ParameterDiagnostics } from "./parameter-diagnostics";
import { SubmissionImageInput } from "./submission-image-input";
import { operationLabel } from "@/features/inputs/image-operation";
import { ResolvedOutputs } from "@/features/prompt/resolved-outputs";
import { commandTool, directorToolLabels } from "@/features/director/model";

export function SubmissionSummary({ submission }: { submission: JobRecord["submission"] }) {
  useTranslation();

  if (submission.kind !== "generation")
    return (
      <div>
        <Grid
          gap={0}
          align="stretch"
          columns={1}
          as="dl"
          className="generation-metadata [&_>_div]:grid-cols-[76px_minmax(0,_1fr)] [&_dt]:text-muted [&_dd]:wrap-anywhere [&_>_div]:grid [&_>_div]:gap-space-3 [&_dd]:m-0 grid gap-space-3 m-0 text-label"
        >
          <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
            <dt>{t("generation.operation")}</dt>
            <dd>{submissionLabel(submission)}</dd>
          </Grid>
          {submission.kind === "encodeVibe" && (
            <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
              <dt>{t("generation.informationExtraction")}</dt>
              <dd>{submission.informationExtracted}</dd>
            </Grid>
          )}
          {submission.kind === "director" && (
            <>
              <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
                <dt>{t("generation.tool")}</dt>
                <dd>{directorToolLabels[commandTool(submission.command)]}</dd>
              </Grid>
              {typeof submission.command !== "string" &&
                (() => {
                  const options =
                    "emotion" in submission.command
                      ? submission.command.emotion
                      : submission.command.colorize;
                  return (
                    <>
                      <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
                        <dt>{t("generation.prompt")}</dt>
                        <dd>
                          <PromptTextEditor
                            value={options.prompt ?? ""}
                            label={t("generation.directorPrompt")}
                            context="native"
                            readOnly
                            tokenUnavailableLabel={t("generation.directorTokenRulesUnavailable")}
                          />
                        </dd>
                      </Grid>
                      <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
                        <dt>{t("generation.defry")}</dt>
                        <dd>{options.defry}</dd>
                      </Grid>
                    </>
                  );
                })()}
              <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
                <dt>{t("generation.parameterValidation")}</dt>
                <dd>
                  {submission.policy === "reject"
                    ? t("generation.strictRejection")
                    : t("generation.autoAdjust")}
                </dd>
              </Grid>
            </>
          )}
          {submission.kind === "upscale" && (
            <>
              <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
                <dt>{t("generation.upscaleModel")}</dt>
                <dd>{submission.model}</dd>
              </Grid>
              <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
                <dt>{t("generation.blurSigma")}</dt>
                <dd>{submission.declaredBlurSigma}</dd>
              </Grid>
            </>
          )}
        </Grid>
        <SubmissionImageInput operation={submission} />
        <ParameterDiagnostics diagnostics={submission.diagnostics} />
      </div>
    );
  const { resolved, seed } = submission;
  return (
    <div className="generation-submission">
      <ParameterDiagnostics diagnostics={submission.diagnostics} />
      <Grid
        gap={0}
        align="stretch"
        columns={1}
        as="dl"
        className="generation-metadata [&_>_div]:grid-cols-[76px_minmax(0,_1fr)] [&_dt]:text-muted [&_dd]:wrap-anywhere [&_>_div]:grid [&_>_div]:gap-space-3 [&_dd]:m-0 grid gap-space-3 m-0 text-label"
      >
        <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
          <dt>{t("generation.operation")}</dt>
          <dd>
            {operationLabel(resolved.inputs.operation)}
            {resolved.inputs.operation.kind === "inpainting"
              ? ` · ${resolved.inputs.operation.img2img ? t("generation.regionalImageToImage") : t("generation.pureInpainting")}`
              : ""}
          </dd>
        </Grid>
        <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
          <dt>{t("generation.model")}</dt>
          <dd>{resolved.settings.model}</dd>
        </Grid>
        <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
          <dt>{t("generation.dimensions")}</dt>
          <dd>
            {resolved.settings.size.width} × {resolved.settings.size.height}
          </dd>
        </Grid>
        <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
          <dt>{t("generation.sampling")}</dt>
          <dd>
            {t("generation.samplingDetails", {
              sampler: resolved.settings.sampler,
              count: resolved.settings.steps,
              scale: resolved.settings.scale,
            })}
          </dd>
        </Grid>
        <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
          <dt>{t("generation.submissionSeed")}</dt>
          <dd>{seed}</dd>
        </Grid>
        <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
          <dt>{t("generation.sampleCountLabel")}</dt>
          <dd>{resolved.settings.nSamples}</dd>
        </Grid>
        <Grid gap={3} columns={1} className="grid-cols-[76px_minmax(0,1fr)]">
          <dt>{t("generation.parameterValidation")}</dt>
          <dd>
            {resolved.inputs.policy === "reject"
              ? t("generation.strictRejection")
              : t("generation.autoAdjust")}
          </dd>
        </Grid>
      </Grid>
      <SubmissionImageInput operation={resolved.inputs.operation} seed={seed} />
      <details className="generation-prompts [&_summary]:text-muted [&_summary]:cursor-pointer [&_h4]:[margin:var(--space-4)_0_var(--space-1)] [&_h4]:text-muted [&_h4]:text-label mt-[14px]">
        <summary>{t("generation.viewSubmittedPrompts")}</summary>
        <h4>{t("generation.positivePrompt")}</h4>
        <PromptTextEditor
          value={resolved.positive}
          label={t("generation.submittedPositivePrompt")}
          model={resolved.settings.model}
          context="native"
          readOnly
        />
        <h4>{t("generation.negativePrompt")}</h4>
        <PromptTextEditor
          value={resolved.negative}
          label={t("generation.submittedNegativePrompt")}
          model={resolved.settings.model}
          context="native"
          readOnly
        />
      </details>
      <ResolvedOutputs resolved={resolved} />
      <details className="generation-sources mt-space-1">
        <summary>{t("generation.effectiveSettingsSources")}</summary>
        <div className="generation-source-details [&_h4]:[margin:var(--space-4)_0_var(--space-3)] [&_h4]:text-muted [&_h4]:text-label [&_.fragment-list_p]:mt-[5px] max-h-[300px] overflow-auto [padding:2px_var(--space-3)_var(--space-1)] border border-line-subtle rounded-control bg-background">
          <section>
            <h4>{t("generation.contentSources")}</h4>
            <ContentSources fragments={resolved.fragments} />
          </section>
          <section>
            <h4>{t("generation.settingsSources")}</h4>
            <SettingsSources settings={resolved.settings} provenance={resolved.provenance} />
          </section>
        </div>
      </details>
    </div>
  );
}
