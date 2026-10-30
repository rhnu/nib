import { t, useTranslation, errorMessage } from "@/shared/i18n";
import type { ParameterDiagnostic } from "@/bindings/generation";
import { Button } from "@/shared/ui";

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
        {diagnostics.map((diagnostic, index) => (
          <li key={`${diagnostic.field}-${index}`}>
            {diagnostic.field}: {errorMessage(diagnostic.change)}
            {onLocate && (
              <Button className="quiet" onClick={() => onLocate(diagnostic.field)}>
                {t("generation.locate")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
