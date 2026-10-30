import { t, useTranslation } from "@/shared/i18n";
import type {
  ResolvedFragment,
  ResolvedSettings,
  SettingSource,
  SettingsProvenance,
} from "@/bindings/workbench";
import { settingKeys, settingLabels, settingValue } from "./settings";
import { PromptTextEditor } from "./prompt-text-editor";

function sourceLabel(source: SettingSource): string {
  if (source.kind === "draft") return t("prompt.creationOverride");
  if (source.kind === "sdkDefault") return t("prompt.sdkDefault");
  if (source.kind === "presetOverride") return t("prompt.presetInstanceOverride");
  return `${source.name}${source.expanded ? t("prompt.expandedSuffix") : ""}`;
}

/** Render resolved facts directly; historical callers never consult the live resource cache. */
export function ContentSources({
  fragments,
  model,
}: {
  fragments: ResolvedFragment[];
  model?: string;
}) {
  useTranslation();

  if (fragments.length === 0) return <p className="muted">{t("prompt.noContentSources")}</p>;
  return (
    <ol className="fragment-list">
      {fragments.map((fragment, index) => (
        <li key={`${fragment.presetInstanceId ?? "draft"}-${fragment.nodeId}-${index}`}>
          <div>
            <span className="tag">
              {fragment.scope === "positive" ? t("prompt.base") : t("prompt.negative")}
            </span>
            <span>
              {fragment.resourceName ??
                (fragment.presetInstanceId ? t("prompt.presetText") : t("prompt.directText"))}
            </span>
            {fragment.overridden && <span className="accent-text">{t("prompt.override")}</span>}
            {fragment.expanded && <span className="muted">{t("prompt.expanded")}</span>}
          </div>
          <PromptTextEditor
            label={t("prompt.sourcePrompt")}
            value={fragment.text}
            model={model}
            readOnly
          />
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
  useTranslation();

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
