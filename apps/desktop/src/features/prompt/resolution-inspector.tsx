import { t, useTranslation } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import type { Draft, Resource, ResolvedDraft } from "@/bindings/workbench";
import { ContentSources, SettingsSources } from "./resolution-sources";
import type { ParameterDiagnostic } from "@/bindings/generation";
import { Button } from "@/shared/ui";
import {
  diagnosticSetting,
  settingLabels,
  settingKeys,
  settingDiagnosticMessage,
} from "./settings";
import { ResolvedOutputs, ResolvedPromptPair } from "./resolved-outputs";
import { resolutionIssueDetails } from "./output-details";
import { ResolvedPromptAnalysis } from "./resolved-prompt-analysis";

export function ResolutionInspector({
  resolved,
  pending,
  error,
  draft,
  resources,
  tokenModel,
  diagnostics = [],
  diagnosticsOpen = false,
  onFocusField,
}: {
  resolved: ResolvedDraft | null;
  pending: boolean;
  error: string;
  draft: Draft;
  resources: Map<string, Resource>;
  tokenModel?: string;
  diagnostics?: ParameterDiagnostic[];
  diagnosticsOpen?: boolean;
  onFocusField?: (field: string) => void;
}) {
  useTranslation();

  const customSettingCount = resolved
    ? settingKeys.filter((key) => resolved.provenance[key].kind !== "sdkDefault").length
    : 0;

  return (
    <aside className="inspector" aria-label={t("prompt.resolutionSources")} aria-busy={pending}>
      {pending && <output className="muted">{t("prompt.updating")}</output>}
      {error && (
        <p role="alert" className="inline-warning">
          {error}
        </p>
      )}
      {diagnostics.length > 0 && (
        <section
          id="resolution-diagnostics"
          className="resolution-diagnostics"
          hidden={!diagnosticsOpen}
        >
          <h3>{t("prompt.sdkAdjustments")}</h3>
          <table>
            <thead>
              <tr>
                <th scope="col">{t("prompt.setting")}</th>
                <th scope="col">{t("prompt.adjustment")}</th>
                {onFocusField && <th scope="col">{t("prompt.locateSetting")}</th>}
              </tr>
            </thead>
            <tbody>
              {diagnostics.map((diagnostic, index) => {
                const key = diagnosticSetting(diagnostic.field);
                return (
                  <tr key={`${diagnostic.field}-${index}`}>
                    <th scope="row">{key ? settingLabels[key] : diagnostic.field}</th>
                    <td>{settingDiagnosticMessage(diagnostic.field, diagnostic.change)}</td>
                    {onFocusField && (
                      <td>
                        <Button className="quiet" onClick={() => onFocusField(diagnostic.field)}>
                          {t("generation.locate")}
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {resolved && (
        <>
          <section>
            <h3>{t("prompt.basePrompt")}</h3>
            <ResolvedPromptPair
              positive={resolved.positive}
              negative={resolved.negative}
              model={tokenModel ?? resolved.settings.model}
            />
            <details className="resolution-sources">
              <summary>{t("prompt.contentSources")}</summary>
              <ContentSources
                fragments={resolved.fragments}
                model={tokenModel ?? resolved.settings.model}
              />
            </details>
          </section>
          <ResolvedOutputs resolved={resolved} tokenModel={tokenModel} />
          <ResolvedPromptAnalysis
            resolved={resolved}
            model={tokenModel ?? resolved.settings.model}
          />
          <details className="resolution-settings">
            <summary>
              {t("prompt.effectiveSettings")}
              <span className="muted">
                {t("prompt.nonDefaultSettings", { count: customSettingCount })}
              </span>
            </summary>
            <SettingsSources settings={resolved.settings} provenance={resolved.provenance} />
          </details>
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
