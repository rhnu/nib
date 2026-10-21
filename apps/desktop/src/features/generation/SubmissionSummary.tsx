import type { JobRecord } from "../../bindings/generation";
import { ContentSources, SettingsSources } from "../prompt/ResolutionSources";

export function SubmissionSummary({ submission }: { submission: JobRecord["submission"] }) {
  const { resolved, seed } = submission;
  return (
    <div className="generation-submission">
      <dl className="generation-metadata">
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
          <dt>种子</dt>
          <dd>{seed}</dd>
        </div>
      </dl>
      <details className="generation-prompts">
        <summary>查看提交时的提示词</summary>
        <h4>正面提示</h4>
        <pre>{resolved.positive || "（空）"}</pre>
        <h4>负面提示</h4>
        <pre>{resolved.negative || "（空）"}</pre>
      </details>
      <details className="generation-sources">
        <summary>查看提交时的内容与设置来源</summary>
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
