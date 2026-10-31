import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { PromptNode } from "@/bindings/workbench";
import type { PromptTarget } from "./prompt-transfer";

export const promptDragType = "application/x-nib-prompt-node";
type Destination = { target: PromptTarget; label: string; allowChunk: boolean };
type Transfer = { from: PromptTarget; node: PromptNode };
type Controller = {
  active: Transfer | null;
  start: (value: Transfer | null) => void;
  register: (key: string, destination: Destination) => () => void;
  destinations: Map<string, Destination>;
  move: (from: PromptTarget, to: PromptTarget, nodeId: string, beforeId?: string) => void;
};
const Context = createContext<Controller | null>(null);

/** One editing surface owns transfer commits; menus and native dragging share the same operation. */
export function PromptTransferProvider({
  onMove,
  children,
}: {
  onMove: Controller["move"];
  children: ReactNode;
}) {
  const [active, start] = useState<Transfer | null>(null);
  const [destinations, setDestinations] = useState(new Map<string, Destination>());

  const register = useCallback((key: string, destination: Destination) => {
    setDestinations((current) => new Map(current).set(key, destination));
    return () => {
      setDestinations((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
    };
  }, []);

  return (
    <Context.Provider value={{ active, start, register, destinations, move: onMove }}>
      {children}
    </Context.Provider>
  );
}

export function usePromptTransfer() {
  return useContext(Context);
}
