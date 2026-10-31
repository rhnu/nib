import { createContext } from "react";

/** Background editor commits follow the same temporary ownership as interactive edits. */
export const WriteAccessContext = createContext<{ allowed: boolean; canCommit: () => boolean }>({
  allowed: true,
  canCommit: () => true,
});
