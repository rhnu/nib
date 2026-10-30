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
  return (
    <Notice actions={<Button onClick={retry}>重试显示</Button>}>
      {label}显示失败：{errorMessage(error)}
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
  return (
    <ErrorBoundary
      resetKeys={resetKeys}
      onError={(error, info) => console.error(`${label}渲染失败`, error, info.componentStack)}
      fallbackRender={({ error, resetErrorBoundary }) => (
        <RenderFailure label={label} error={error} retry={resetErrorBoundary} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
