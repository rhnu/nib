import { createContext, useContext, type ReactNode } from "react";
import type { LibrarySessionStore } from "./library-session";

const LibrarySessionContext = createContext<LibrarySessionStore | null>(null);

export function LibrarySessionProvider({
  store,
  children,
}: {
  store: LibrarySessionStore;
  children: ReactNode;
}) {
  return <LibrarySessionContext value={store}>{children}</LibrarySessionContext>;
}

export function useLibrarySessionStore() {
  const store = useContext(LibrarySessionContext);
  if (!store) throw new Error("资源库缺少应用会话状态。");
  return store;
}
