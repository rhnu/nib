import { t, useTranslation, MessageError, deferMessage } from "@/shared/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { queryClient } from "@/shared/query/client";
import App from "@/app/app";
import "@/app/styles.css";
import { Notice } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";

const root = document.getElementById("root");

if (!root) {
  throw new MessageError(deferMessage(() => t("app.rootMissing")));
}

function RootFailure({ error }: { error: unknown }) {
  useTranslation();
  return <Notice>{t("app.rootFailure", { detail: errorMessage(error) })}</Notice>;
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary
      onError={(error, info) =>
        console.error("Application root render failed", error, info.componentStack)
      }
      fallbackRender={({ error }) => <RootFailure error={error} />}
    >
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
