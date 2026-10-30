import { t, errorMessage } from "@/shared/i18n";
import { useId, useState } from "react";
import type { ParameterDiagnostic } from "@/bindings/generation";

/** Associates SDK feedback with controls and opens advanced fields when they need attention. */
export function useImageOperationFeedback(
  diagnostics: ParameterDiagnostic[],
  errorFields: string[],
) {
  const prefix = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dismissedAdvanced, setDismissedAdvanced] = useState("");

  const diagnosticSignature = diagnostics
    .map((item) => `${item.field}:${errorMessage(item.change)}`)
    .join("|");
  const errorSignature = errorFields.join("|");
  const isAdvancedDiagnostic = [...diagnostics.map((item) => item.field), ...errorFields].some(
    (field) => /extra_?noise_?seed|color_?correct|add_?original_?image/i.test(field),
  );
  const advancedSignature = `${diagnosticSignature}|${errorSignature}`;
  const showAdvanced =
    advancedOpen || (isAdvancedDiagnostic && dismissedAdvanced !== advancedSignature);

  const diagnostic = (field: string) =>
    diagnostics.filter((item) =>
      item.field.replaceAll("_", "").toLowerCase().split(".").includes(field.toLowerCase()),
    );

  const rejected = (field: string) =>
    errorFields.some((path) =>
      path.replaceAll("_", "").toLowerCase().split(".").includes(field.toLowerCase()),
    );

  const controlProps = (field: string) => ({
    "aria-invalid": rejected(field) || undefined,
    "aria-describedby":
      diagnostic(field).length || rejected(field) ? `${prefix}-${field}-message` : undefined,
  });

  const messages = (field: string) =>
    diagnostic(field).length > 0 || rejected(field) ? (
      <output className="image-operation-diagnostic" id={`${prefix}-${field}-message`}>
        {diagnostic(field).map((item, index) => (
          <span key={index}>{errorMessage(item.change)}</span>
        ))}
        {rejected(field) && <span>{t("inputs.fieldRejected")}</span>}
      </output>
    ) : null;

  const setAdvancedOpenState = (open: boolean) => {
    setAdvancedOpen(open);
    if (!open) setDismissedAdvanced(advancedSignature);
  };

  return {
    prefix,
    controlProps,
    messages,
    rejected,
    showAdvanced,
    setAdvancedOpen: setAdvancedOpenState,
  };
}

export type ImageOperationFeedback = ReturnType<typeof useImageOperationFeedback>;
