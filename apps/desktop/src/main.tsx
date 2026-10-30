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
  throw new Error("The application root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary
      onError={(error, info) => console.error("应用根组件渲染失败", error, info.componentStack)}
      fallbackRender={({ error }) => (
        <Notice>应用无法显示：{errorMessage(error)}。请重新打开应用。</Notice>
      )}
    >
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
