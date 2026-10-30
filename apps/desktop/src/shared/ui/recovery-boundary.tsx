import { t, useTranslation } from "@/shared/i18n";
import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { errorMessage } from "@/shared/host/error";
import { Button } from "./button";
import { Notice } from "./notice";

export function RenderFailure({
  label,
  error,
  retry,
}: {
  label: string;
  error: unknown;
  retry: () => void;
}) {
  useTranslation();

  return (
    <Notice actions={<Button onClick={retry}>{t("common.retryDisplay")}</Button>}>
      {t("common.displayFailed", { label, detail: errorMessage(error) })}
    </Notice>
  );
}

/** Retry only the failed surface; its editor and save coordinator live above this boundary. */
export function RecoveryBoundary({
  children,
  label,
  resetKeys,
}: {
  children: ReactNode;
  label: string;
  resetKeys?: unknown[];
}) {
  useTranslation();

  return (
    <ErrorBoundary
      resetKeys={resetKeys}
      onError={(error, info) =>
        console.error(t("common.renderFailed", { value0: label }), error, info.componentStack)
      }
      fallbackRender={({ error, resetErrorBoundary }) => (
        <RenderFailure label={label} error={error} retry={resetErrorBoundary} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
