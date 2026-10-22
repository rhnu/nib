import type { Draft, ResolutionIssue, Resource, ResolvedDraft } from "../../bindings/workbench";
import { ContentSources, SettingsSources } from "./ResolutionSources";
import type { ParameterDiagnostic } from "../../bindings/generation";
import { Button } from "../../shared/ui";
import { diagnosticSetting, settingLabels } from "./settings";

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
  const issueContext = (issue: ResolutionIssue): string => {
    const labels: string[] = [];
    const instance = draft.presets.find((item) => item.id === issue.presetInstanceId);
    const resource =
      instance?.binding.kind === "linked" ? resources.get(instance.binding.resourceId) : undefined;
    if (instance) {
      labels.push(
        instance.binding.kind === "expanded"
          ? instance.binding.name
          : (resource?.name ?? "缺失的 Preset"),
      );
    } else labels.push("当前创作");
    if (issue.scope) labels.push(issue.scope === "positive" ? "基础提示" : "负面提示");
    const composition = instance
      ? instance.binding.kind === "expanded"
        ? instance.binding.composition
        : resource?.content.kind === "preset"
          ? resource.content.composition
          : undefined
      : draft.composition;
    if (issue.nodeId && composition) {
      const nodes = issue.scope
        ? composition[issue.scope]
        : [...composition.positive, ...composition.negative];
      const index = nodes.findIndex((node) => node.id === issue.nodeId);
      labels.push(index >= 0 ? `第 ${index + 1} 个片段` : "已移除的片段覆盖");
    }
    return labels.join(" · ");
  };
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
                    {key && onFocusField && (
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
              {resolved.issues.map((issue, index) => (
                <div key={index}>
                  <h3>{issueContext(issue)}</h3>
                  <p>{issue.message}</p>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </aside>
  );
}
