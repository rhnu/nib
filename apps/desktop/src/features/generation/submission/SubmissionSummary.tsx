import { PromptTextEditor } from "../../prompt/PromptTextEditor";
import type { JobRecord } from "../../../bindings/generation";
import { ContentSources, SettingsSources } from "../../prompt/ResolutionSources";
import { submissionLabel } from "./operation";
import { ParameterDiagnostics } from "./ParameterDiagnostics";
import { SubmissionImageInput } from "./SubmissionImageInput";
import { operationLabel } from "../../inputs/image-operation";
import { ResolvedOutputs } from "../../prompt/ResolvedOutputs";
import { commandTool, directorToolLabels } from "../../director/model";

export function SubmissionSummary({ submission }: { submission: JobRecord["submission"] }) {
  if (submission.kind !== "generation")
    return (
      <div>
        <dl className="generation-metadata">
          <div>
            <dt>操作</dt>
            <dd>{submissionLabel(submission)}</dd>
          </div>
          {submission.kind === "encodeVibe" && (
            <div>
              <dt>信息提取</dt>
              <dd>{submission.informationExtracted}</dd>
            </div>
          )}
          {submission.kind === "director" && (
            <>
              <div>
                <dt>工具</dt>
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
                        <dt>Prompt</dt>
                        <dd>
                          <PromptTextEditor
                            value={options.prompt ?? ""}
                            label="导演工具 Prompt"
                            readOnly
                            tokenUnavailableLabel="导演工具未提供本地 Token 规则"
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>Defry</dt>
                        <dd>{options.defry}</dd>
                      </div>
                    </>
                  );
                })()}
              <div>
                <dt>参数校验</dt>
                <dd>{submission.policy === "reject" ? "严格拒绝" : "自动调整"}</dd>
              </div>
            </>
          )}
          {submission.kind === "upscale" && (
            <>
              <div>
                <dt>放大模型</dt>
                <dd>{submission.model}</dd>
              </div>
              <div>
                <dt>Blur Sigma</dt>
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
          <dt>操作</dt>
          <dd>
            {operationLabel(resolved.inputs.operation)}
            {resolved.inputs.operation.kind === "inpainting"
              ? ` · ${resolved.inputs.operation.img2img ? "局部图生图" : "纯补绘"}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>模型</dt>
          <dd>{resolved.settings.model}</dd>
        </div>
        <div>
          <dt>尺寸</dt>
          <dd>
            {resolved.settings.size.width} × {resolved.settings.size.height}
          </dd>
        </div>
        <div>
          <dt>采样</dt>
          <dd>
            {resolved.settings.sampler} · {resolved.settings.steps} 步 · Scale{" "}
            {resolved.settings.scale}
          </dd>
        </div>
        <div>
          <dt>提交种子</dt>
          <dd>{seed}</dd>
        </div>
        <div>
          <dt>样本数</dt>
          <dd>{resolved.settings.nSamples}</dd>
        </div>
        <div>
          <dt>参数校验</dt>
          <dd>{resolved.inputs.policy === "reject" ? "严格拒绝" : "自动调整"}</dd>
        </div>
      </dl>
      <SubmissionImageInput operation={resolved.inputs.operation} seed={seed} />
      <details className="generation-prompts">
        <summary>查看提交时的提示词</summary>
        <h4>正面提示</h4>
        <PromptTextEditor
          value={resolved.positive}
          label="提交时正面提示词"
          model={resolved.settings.model}
          readOnly
        />
        <h4>负面提示</h4>
        <PromptTextEditor
          value={resolved.negative}
          label="提交时负面提示词"
          model={resolved.settings.model}
          readOnly
        />
      </details>
      <ResolvedOutputs resolved={resolved} />
      <details className="generation-sources">
        <summary>完整有效设置与内容来源</summary>
        <div className="generation-source-details">
          <section>
            <h4>内容来源</h4>
            <ContentSources fragments={resolved.fragments} />
          </section>
          <section>
            <h4>设置来源</h4>
            <SettingsSources settings={resolved.settings} provenance={resolved.provenance} />
          </section>
        </div>
      </details>
    </div>
  );
}
