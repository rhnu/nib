import { t, useTranslation } from "@/shared/i18n";
import type {
  ResolvedFragment,
  ResolvedSettings,
  SettingSource,
  SettingsProvenance,
} from "@/bindings/workbench";
import { settingKeys, settingLabels, settingValue } from "./settings";
import { PromptTextEditor } from "./prompt-text-editor";
import { Pencil } from "lucide-react";

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

  if (fragments.length === 0)
    return <p className="muted text-muted">{t("prompt.noContentSources")}</p>;
  return (
    <ol className="fragment-list [&_li]:mb-[14px] [&_li_>_div]:flex [&_li_>_div]:items-center [&_li_>_div]:flex-wrap [&_li_>_div]:gap-[5px] [&_li_>_div]:text-caption [&_p]:text-muted [&_p]:text-caption [&_p]:whitespace-pre-wrap [&_p]:[margin:5px_0_0] m-0 p-0 list-none">
      {fragments.map((fragment, index) => (
        <li key={`${fragment.presetInstanceId ?? "draft"}-${fragment.nodeId}-${index}`}>
          <div>
            <span className="tag inline-flex items-center p-[1px_5px] leading-[19px] text-[10px] rounded-control bg-accent-soft text-accent whitespace-nowrap">
              {fragment.scope === "positive" ? t("prompt.base") : t("prompt.negative")}
            </span>
            <span>
              {fragment.resourceName ??
                (fragment.presetInstanceId ? t("prompt.presetText") : t("prompt.directText"))}
            </span>
            {fragment.overridden && <span className="text-accent">{t("prompt.override")}</span>}
            {fragment.expanded && <span className="muted text-muted">{t("prompt.expanded")}</span>}
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
    <dl className="provenance-list [&_>_div]:grid [&_>_div]:grid-cols-[55px_minmax(0,_1fr)] [&_>_div]:gap-space-3 [&_>_div]:mb-space-4 [&_>_div]:text-caption [&_dt]:text-muted [&_dd]:wrap-anywhere [&_strong]:font-[450] [&_small]:block [&_small]:text-muted [&_small]:text-[10px] [&_small]:mt-[3px] [&_dd]:m-0 m-0">
      {settingKeys.map((key) => (
        <div key={key} data-custom={provenance[key].kind !== "sdkDefault" ? "" : undefined}>
          <dt>
            {settingLabels[key]}
            {provenance[key].kind !== "sdkDefault" && <Pencil size={11} aria-hidden />}
          </dt>
          <dd>
            <strong>{settingValue(key, settings[key])}</strong>
            <small>{sourceLabel(provenance[key])}</small>
          </dd>
        </div>
      ))}
    </dl>
  );
}
