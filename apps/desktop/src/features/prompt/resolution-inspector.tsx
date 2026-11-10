import { Button, Col } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import type { Draft, Resource, ResolvedDraft } from "@/bindings/workbench";
import { ContentSources, SettingsSources } from "./resolution-sources";
import type { ParameterDiagnostic } from "@/bindings/generation";

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
    <Col
      gap={0}
      align="stretch"
      as="aside"
      className="inspector flex flex-1 flex-col gap-space-4 bg-panel p-space-5 overflow-auto min-w-0 min-h-0 [&_>_*]:shrink-0 [&_:is(h3,_h4)]:m-0 [&_:is(h3,_h4)]:text-foreground [&_:is(h3,_h4)]:text-body [&_:is(h3,_h4)]:font-semibold [&_summary]:cursor-pointer [&_summary]:text-muted [&_summary]:text-label [&_details[open]_>_summary]:mb-space-3 [&_.provenance-list]:grid [&_.provenance-list]:grid-cols-[repeat(auto-fit,_minmax(180px,_1fr))] [&_.provenance-list]:gap-y-space-2 [&_.provenance-list]:gap-x-space-4 [&_.provenance-list_>_div]:grid [&_.provenance-list_>_div]:grid-cols-1 [&_.provenance-list_>_div]:gap-[3px] [&_.provenance-list_>_div]:py-space-2 [&_.provenance-list_>_div]:px-space-3 [&_.provenance-list_>_div]:border-l-2 [&_.provenance-list_>_div]:border-transparent [&_.provenance-list_>_div]:text-muted [&_.provenance-list_dt]:flex [&_.provenance-list_dt]:items-center [&_.provenance-list_dt]:gap-[5px] [&_.provenance-list_[data-custom]]:[border-left-color:var(--accent)] [&_.provenance-list_[data-custom]]:bg-accent-soft [&_.provenance-list_[data-custom]]:text-foreground [&_.provenance-list_[data-custom]_dt]:text-accent [&_.provenance-list_small]:mt-[2px] [&_.fragment-list]:grid [&_.fragment-list]:gap-space-3 [&_.fragment-list_li]:grid [&_.fragment-list_li]:gap-space-1 [&_>_section:not([hidden])]:grid [&_>_section:not([hidden])]:gap-space-3 [&_.resolved-outputs_>_section]:grid [&_.resolved-outputs_>_section]:gap-space-3 [&_.resolved-outputs]:m-0 [&_.resolved-outputs]:gap-space-4 [&_.resolved-output-item]:gap-space-3 [&_.resolved-output-item]:pt-space-3 [&_.provenance-list_>_div]:m-0 [&_.fragment-list_li]:m-0"
      aria-label={t("prompt.resolutionSources")}
      aria-busy={pending}
    >
      {pending && <output className="muted text-muted">{t("prompt.updating")}</output>}
      {error && (
        <p role="alert" className="inline-warning text-danger text-label leading-[1.7]">
          {error}
        </p>
      )}
      {diagnostics.length > 0 && (
        <section
          id="resolution-diagnostics"
          className="resolution-diagnostics [&_table]:w-full [&_table]:border-collapse [&_table]:table-fixed [&_table]:text-label [&_:is(th,_td)]:py-space-2 [&_:is(th,_td)]:px-space-3 [&_:is(th,_td)]:border-b [&_:is(th,_td)]:border-line-subtle [&_:is(th,_td)]:text-left [&_:is(th,_td)]:[vertical-align:top] [&_:is(th,_td)]:wrap-anywhere [&_:is(th,_td)]:whitespace-pre-wrap [&_th]:text-muted [&_th]:font-medium [&_th:first-child]:w-[24%] [&_th:last-child:not(:nth-child(2))]:w-[88px]"
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
                        <Button
                          variant="quiet"
                          className=""
                          onClick={() => onFocusField(diagnostic.field)}
                        >
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
          <details className="resolution-settings [&_>_summary]:text-foreground [&_>_summary]:font-semibold [&_>_summary_>_span]:ml-space-3 [&_>_summary_>_span]:font-normal border-t border-line-subtle pt-[10px]">
            <summary>
              {t("prompt.effectiveSettings")}
              <span className="muted text-muted">
                {t("prompt.nonDefaultSettings", { count: customSettingCount })}
              </span>
            </summary>
            <SettingsSources settings={resolved.settings} provenance={resolved.provenance} />
          </details>
          {resolved.issues.length > 0 && (
            <section className="resolution-issues [&_>_div]:p-space-3 [&_>_div]:border-l-2 [&_>_div]:border-danger [&_>_div]:bg-background [&_p]:my-space-1 [&_p]:mx-0 [&_p]:text-danger [&_p]:text-label [&_p]:leading-[1.7]">
              <h3>{t("prompt.needsAttention")}</h3>
              {resolved.issues.map((issue, index) => {
                const details = resolutionIssueDetails(issue, draft, resources);
                return (
                  <div key={index}>
                    <h3>{details.label}</h3>
                    <p>{errorMessage(issue.message)}</p>
                    {details.target && onFocusField && (
                      <Button
                        variant="quiet"
                        className=""
                        onClick={() => onFocusField(details.target!)}
                      >
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
    </Col>
  );
}
