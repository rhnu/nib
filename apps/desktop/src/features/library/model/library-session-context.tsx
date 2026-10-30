import { t, useTranslation, deferMessage, MessageError } from "@/shared/i18n";
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
  useTranslation();

  return <LibrarySessionContext value={store}>{children}</LibrarySessionContext>;
}

export function useLibrarySessionStore() {
  const store = useContext(LibrarySessionContext);
  if (!store) throw new MessageError(deferMessage(() => t("library.missingSession")));
  return store;
}
