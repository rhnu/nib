import type {
  ResolvedFragment,
  ResolvedSettings,
  SettingSource,
  SettingsProvenance,
} from "@/bindings/workbench";
import { settingKeys, settingLabels, settingValue } from "./settings";
import { PromptTextEditor } from "./prompt-text-editor";

function sourceLabel(source: SettingSource): string {
  if (source.kind === "draft") return "创作覆盖";
  if (source.kind === "sdkDefault") return "SDK 默认";
  if (source.kind === "presetOverride") return "配方实例覆盖";
  return `${source.name}${source.expanded ? "（已展开）" : ""}`;
}

/** Render resolved facts directly; historical callers never consult the live resource cache. */
export function ContentSources({
  fragments,
  model,
}: {
  fragments: ResolvedFragment[];
  model?: string;
}) {
  if (fragments.length === 0) return <p className="muted">没有内容来源。</p>;
  return (
    <ol className="fragment-list">
      {fragments.map((fragment, index) => (
        <li key={`${fragment.presetInstanceId ?? "draft"}-${fragment.nodeId}-${index}`}>
          <div>
            <span className="tag">{fragment.scope === "positive" ? "基础" : "负面"}</span>
            <span>
              {fragment.resourceName ?? (fragment.presetInstanceId ? "配方文本" : "直接文本")}
            </span>
            {fragment.overridden && <span className="accent-text">覆盖</span>}
            {fragment.expanded && <span className="muted">已展开</span>}
          </div>
          <PromptTextEditor label="来源提示词" value={fragment.text} model={model} readOnly />
        </li>
      ))}
    </ol>
  );
}

export function SettingsSources({
  settings,
  provenance,
}: {
  settings: ResolvedSettings;
  provenance: SettingsProvenance;
}) {
  return (
    <dl className="provenance-list">
      {settingKeys.map((key) => (
        <div key={key}>
          <dt>{settingLabels[key]}</dt>
          <dd>
            <strong>{settingValue(key, settings[key])}</strong>
            <small>{sourceLabel(provenance[key])}</small>
          </dd>
        </div>
      ))}
    </dl>
  );
}
