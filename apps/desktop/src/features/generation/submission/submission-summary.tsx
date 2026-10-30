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
        <dl className="generation-metadata">
          <div>
            <dt>{t("generation.operation")}</dt>
            <dd>{submissionLabel(submission)}</dd>
          </div>
          {submission.kind === "encodeVibe" && (
            <div>
              <dt>{t("generation.informationExtraction")}</dt>
              <dd>{submission.informationExtracted}</dd>
            </div>
          )}
          {submission.kind === "director" && (
            <>
              <div>
                <dt>{t("generation.tool")}</dt>
                <dd>{directorToolLabels[commandTool(submission.command)]}</dd>
              </div>
              {typeof submission.command !== "string" &&
                (() => {
                  const options =
                    "emotion" in submission.command
                      ? submission.command.emotion
                      : submission.command.colorize;
                  return (
                    <>
                      <div>
                        <dt>{t("generation.prompt")}</dt>
                        <dd>
                          <PromptTextEditor
                            value={options.prompt ?? ""}
                            label={t("generation.directorPrompt")}
                            readOnly
                            tokenUnavailableLabel={t("generation.directorTokenRulesUnavailable")}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>{t("generation.defry")}</dt>
                        <dd>{options.defry}</dd>
                      </div>
                    </>
                  );
                })()}
              <div>
                <dt>{t("generation.parameterValidation")}</dt>
                <dd>
                  {submission.policy === "reject"
                    ? t("generation.strictRejection")
                    : t("generation.autoAdjust")}
                </dd>
              </div>
            </>
          )}
          {submission.kind === "upscale" && (
            <>
              <div>
                <dt>{t("generation.upscaleModel")}</dt>
                <dd>{submission.model}</dd>
              </div>
              <div>
                <dt>{t("generation.blurSigma")}</dt>
                <dd>{submission.declaredBlurSigma}</dd>
              </div>
            </>
          )}
        </dl>
        <SubmissionImageInput operation={submission} />
        <ParameterDiagnostics diagnostics={submission.diagnostics} />
      </div>
    );
  const { resolved, seed } = submission;
  return (
    <div className="generation-submission">
      <ParameterDiagnostics diagnostics={submission.diagnostics} />
      <dl className="generation-metadata">
        <div>
          <dt>{t("generation.operation")}</dt>
          <dd>
            {operationLabel(resolved.inputs.operation)}
            {resolved.inputs.operation.kind === "inpainting"
              ? ` · ${resolved.inputs.operation.img2img ? t("generation.regionalImageToImage") : t("generation.pureInpainting")}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>{t("generation.model")}</dt>
          <dd>{resolved.settings.model}</dd>
        </div>
        <div>
          <dt>{t("generation.dimensions")}</dt>
          <dd>
            {resolved.settings.size.width} × {resolved.settings.size.height}
          </dd>
        </div>
        <div>
          <dt>{t("generation.sampling")}</dt>
          <dd>
            {t("generation.samplingDetails", {
              sampler: resolved.settings.sampler,
              count: resolved.settings.steps,
              scale: resolved.settings.scale,
            })}
          </dd>
        </div>
        <div>
          <dt>{t("generation.submissionSeed")}</dt>
          <dd>{seed}</dd>
        </div>
        <div>
          <dt>{t("generation.sampleCountLabel")}</dt>
          <dd>{resolved.settings.nSamples}</dd>
        </div>
        <div>
          <dt>{t("generation.parameterValidation")}</dt>
          <dd>
            {resolved.inputs.policy === "reject"
              ? t("generation.strictRejection")
              : t("generation.autoAdjust")}
          </dd>
        </div>
      </dl>
      <SubmissionImageInput operation={resolved.inputs.operation} seed={seed} />
      <details className="generation-prompts">
        <summary>{t("generation.viewSubmittedPrompts")}</summary>
        <h4>{t("generation.positivePrompt")}</h4>
        <PromptTextEditor
          value={resolved.positive}
          label={t("generation.submittedPositivePrompt")}
          model={resolved.settings.model}
          readOnly
        />
        <h4>{t("generation.negativePrompt")}</h4>
        <PromptTextEditor
          value={resolved.negative}
          label={t("generation.submittedNegativePrompt")}
          model={resolved.settings.model}
          readOnly
        />
      </details>
      <ResolvedOutputs resolved={resolved} />
      <details className="generation-sources">
        <summary>{t("generation.effectiveSettingsSources")}</summary>
        <div className="generation-source-details">
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
