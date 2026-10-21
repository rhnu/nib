import type {
  Draft,
  ResolutionIssue,
  Resource,
  ResolvedDraft,
  SettingSource,
} from "./bindings/workbench";

function sourceLabel(source: SettingSource): string {
  if (source.kind === "draft") return "当前创作";
  if (source.kind === "sdkDefault") return "SDK 默认";
  return `${source.name}${source.expanded ? "（已展开）" : ""}`;
}

export function ResolutionInspector({
  resolved,
  pending,
  error,
  draft,
  resources,
}: {
  resolved: ResolvedDraft | null;
  pending: boolean;
  error: string;
  draft: Draft;
  resources: Map<string, Resource>;
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
      <header className="section-heading">
        <h2>解析与来源</h2>
        <span className="muted">{pending ? "正在更新…" : resolved ? "实时解析" : ""}</span>
      </header>
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
            {resolved.fragments.length === 0 ? (
              <p className="muted">添加内容后显示来源。</p>
            ) : (
              <ol className="fragment-list">
                {resolved.fragments.map((fragment, index) => (
                  <li key={`${fragment.presetInstanceId ?? "draft"}-${fragment.nodeId}-${index}`}>
                    <div>
                      <span className="tag">{fragment.scope === "positive" ? "基础" : "负面"}</span>
                      <span>
                        {fragment.resourceName ??
                          (fragment.presetInstanceId ? "配方文本" : "直接文本")}
                      </span>
                      {fragment.overridden && <span className="accent-text">覆盖</span>}
                      {fragment.expanded && <span className="muted">已展开</span>}
                    </div>
                    <p>{fragment.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section>
            <h3>生效设置</h3>
            <dl className="provenance-list">
              {(
                [
                  ["model", "模型"],
                  ["size", "尺寸"],
                  ["steps", "Steps"],
                  ["scale", "Guidance"],
                  ["sampler", "采样器"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    <strong>
                      {key === "size"
                        ? `${resolved.settings.size.width} × ${resolved.settings.size.height}`
                        : resolved.settings[key]}
                    </strong>
                    <small>{sourceLabel(resolved.provenance[key])}</small>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
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
