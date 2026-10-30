import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "./messages";

/** Retain semantic errors and format on render so changing language keeps the current feedback. */
export function useMessageState(initial: unknown = ""): [string, (message: unknown) => void] {
  useTranslation();
  const [message, setMessage] = useState<unknown>(() => initial);

  const update = useCallback((next: unknown) => setMessage(() => next), []);

  return [
    message === null || message === undefined || message === "" ? "" : errorMessage(message),
    update,
  ];
}
