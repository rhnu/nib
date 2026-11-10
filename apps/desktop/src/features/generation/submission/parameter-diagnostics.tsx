import { Button } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import type { ParameterDiagnostic } from "@/bindings/generation";

import {
  diagnosticSetting,
  settingLabels,
  settingDiagnosticMessage,
} from "@/features/prompt/settings";

export function ParameterDiagnostics({
  diagnostics,
  onLocate,
}: {
  diagnostics: ParameterDiagnostic[];
  onLocate?: (field: string) => void;
}) {
  useTranslation();

  if (diagnostics.length === 0) return null;
  return (
    <details>
      <summary>{t("generation.sdkAdjustmentCount", { count: diagnostics.length })}</summary>
      <ul>
        {diagnostics.map((diagnostic, index) => {
          const key = diagnosticSetting(diagnostic.field);
          return (
            <li key={`${diagnostic.field}-${index}`}>
              {key ? settingLabels[key] : diagnostic.field}:{" "}
              {settingDiagnosticMessage(diagnostic.field, diagnostic.change)}
              {onLocate && (
                <Button variant="quiet" className="" onClick={() => onLocate(diagnostic.field)}>
                  {t("generation.locate")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
