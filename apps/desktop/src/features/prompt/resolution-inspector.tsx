import { t, useTranslation } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import type { Draft, Resource, ResolvedDraft } from "@/bindings/workbench";
import { ContentSources, SettingsSources } from "./resolution-sources";
import type { ParameterDiagnostic } from "@/bindings/generation";
import { Button } from "@/shared/ui";
import { diagnosticSetting, settingLabels } from "./settings";
import { ResolvedOutputs } from "./resolved-outputs";
import { resolutionIssueDetails } from "./output-details";
import { PromptTextEditor } from "./prompt-text-editor";

export function ResolutionInspector({
  resolved,
  pending,
  error,
  draft,
  resources,
  tokenModel,
  diagnostics = [],
  onFocusField,
}: {
  resolved: ResolvedDraft | null;
  pending: boolean;
  error: string;
  draft: Draft;
  resources: Map<string, Resource>;
  tokenModel?: string;
  diagnostics?: ParameterDiagnostic[];
  onFocusField?: (field: string) => void;
}) {
  useTranslation();

  return (
    <aside className="inspector" aria-label={t("prompt.resolutionSources")} aria-busy={pending}>
      {pending && <output className="muted">{t("prompt.updating")}</output>}
      {error && (
        <p role="alert" className="inline-warning">
          {error}
        </p>
      )}
      {resolved && (
        <>
          <section>
            <h3>{t("prompt.basePrompt")}</h3>
            <PromptTextEditor
              label={t("prompt.basePrompt")}
              value={resolved.positive}
              model={tokenModel ?? resolved.settings.model}
              readOnly
              placeholder={t("prompt.noBasePrompt")}
            />
          </section>
          <section>
            <h3>{t("prompt.negativePrompt")}</h3>
            <PromptTextEditor
              label={t("prompt.negativePrompt")}
              value={resolved.negative}
              model={tokenModel ?? resolved.settings.model}
              readOnly
              placeholder={t("prompt.noNegativePrompt")}
            />
          </section>
          <ResolvedOutputs resolved={resolved} tokenModel={tokenModel} />
          <section>
            <h3>{t("prompt.contentSources")}</h3>
            <ContentSources
              fragments={resolved.fragments}
              model={tokenModel ?? resolved.settings.model}
            />
          </section>
          <section>
            <h3>{t("prompt.effectiveSettings")}</h3>
            <SettingsSources settings={resolved.settings} provenance={resolved.provenance} />
          </section>
          {diagnostics.length > 0 && (
            <section className="resolution-diagnostics">
              <h3>{t("prompt.sdkAdjustments")}</h3>
              {diagnostics.map((diagnostic, index) => {
                const key = diagnosticSetting(diagnostic.field);
                return (
                  <div key={index}>
                    <strong>{key ? settingLabels[key] : diagnostic.field}</strong>
                    <p>{errorMessage(diagnostic.change)}</p>
                    {onFocusField && (
                      <Button className="quiet" onClick={() => onFocusField(diagnostic.field)}>
                        {t("prompt.locateSetting")}
                      </Button>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          {resolved.issues.length > 0 && (
            <section className="resolution-issues">
              <h3>{t("prompt.needsAttention")}</h3>
              {resolved.issues.map((issue, index) => {
                const details = resolutionIssueDetails(issue, draft, resources);
                return (
                  <div key={index}>
                    <h3>{details.label}</h3>
                    <p>{errorMessage(issue.message)}</p>
                    {details.target && onFocusField && (
                      <Button className="quiet" onClick={() => onFocusField(details.target!)}>
                        {t("prompt.locateContent")}
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
