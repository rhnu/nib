import { QueryClient } from "@tanstack/react-query";

/** IPC reads remain available offline; paid mutations are never automatically retried. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: false, networkMode: "always" },
    mutations: { retry: false, networkMode: "always" },
  },
});
