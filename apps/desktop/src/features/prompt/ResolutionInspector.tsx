import type { Draft, Resource, ResolvedDraft } from "../../bindings/workbench";
import { ContentSources, SettingsSources } from "./ResolutionSources";
import type { ParameterDiagnostic } from "../../bindings/generation";
import { Button } from "../../shared/ui";
import { diagnosticSetting, settingLabels } from "./settings";
import { ResolvedOutputs } from "./ResolvedOutputs";
import { resolutionIssueDetails } from "./output-details";

export function ResolutionInspector({
  resolved,
  pending,
  error,
  draft,
  resources,
  diagnostics = [],
  onFocusField,
}: {
  resolved: ResolvedDraft | null;
  pending: boolean;
  error: string;
  draft: Draft;
  resources: Map<string, Resource>;
  diagnostics?: ParameterDiagnostic[];
  onFocusField?: (field: string) => void;
}) {
  return (
    <aside className="inspector" aria-label="解析与来源" aria-busy={pending}>
      {pending && <output className="muted">正在更新…</output>}
      {error && (
        <p role="alert" className="inline-warning">
          {error}
        </p>
      )}
      {resolved && (
        <>
          <section>
            <h3>基础提示</h3>
            <p className="resolved-text">{resolved.positive || "暂无基础提示"}</p>
          </section>
          <section>
            <h3>负面提示</h3>
            <p className="resolved-text">{resolved.negative || "暂无负面提示"}</p>
          </section>
          <ResolvedOutputs resolved={resolved} />
          <section>
            <h3>内容来源</h3>
            <ContentSources fragments={resolved.fragments} />
          </section>
          <section>
            <h3>生效设置</h3>
            <SettingsSources settings={resolved.settings} provenance={resolved.provenance} />
          </section>
          {diagnostics.length > 0 && (
            <section className="resolution-diagnostics">
              <h3>SDK 参数调整</h3>
              {diagnostics.map((diagnostic, index) => {
                const key = diagnosticSetting(diagnostic.field);
                return (
                  <div key={index}>
                    <strong>{key ? settingLabels[key] : diagnostic.field}</strong>
                    <p>{diagnostic.change}</p>
                    {onFocusField && (
                      <Button className="quiet" onClick={() => onFocusField(diagnostic.field)}>
                        定位设置
                      </Button>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          {resolved.issues.length > 0 && (
            <section className="resolution-issues">
              <h3>需要处理</h3>
              {resolved.issues.map((issue, index) => {
                const details = resolutionIssueDetails(issue, draft, resources);
                return (
                  <div key={index}>
                    <h3>{details.label}</h3>
                    <p>{issue.message}</p>
                    {details.target && onFocusField && (
                      <Button className="quiet" onClick={() => onFocusField(details.target!)}>
                        定位内容
                      </Button>
                    )}
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
    </aside>
  );
}
