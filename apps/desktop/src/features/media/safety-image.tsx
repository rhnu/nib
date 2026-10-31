import {
  createContext,
  useContext,
  useState,
  type ComponentProps,
  type SyntheticEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApplicationPreferences } from "@/bindings/settings";
import { t, useTranslation } from "@/shared/i18n";
import { safetyApi } from "./safety-api";
import { shouldBlurImage } from "./safety-display";
import "./safety.css";

export const SafetyPreferencesContext = createContext<ApplicationPreferences["safety"]>({
  autoScan: true,
  useWdReview: true,
  blurNsfw: true,
  blurDetails: false,
});

export function useImageSafety(assetId: string | null) {
  const preferences = useContext(SafetyPreferencesContext);
  return useQuery({
    queryKey: ["image-safety", assetId, preferences.autoScan, preferences.useWdReview],
    queryFn: () => safetyApi.get(assetId!),
    enabled: Boolean(assetId),
    meta: { downloadableResources: ["anime-dbrating", "wd-swinv2-tagger-v3"] },
    refetchInterval: (query) =>
      query.state.data?.status === "unknown" ? (query.state.data.reason ? 10000 : 3000) : false,
    refetchOnWindowFocus: true,
  });
}

/** Reveal belongs to one mounted viewer and one image, never to the persisted assessment. */
export function useSafetyDisplay(assetId: string | null, details = false) {
  const preferences = useContext(SafetyPreferencesContext);
  const safety = useImageSafety(assetId);
  const [viewer, setViewer] = useState({ assetId, revealed: false });
  if (viewer.assetId !== assetId) setViewer({ assetId, revealed: false });
  const blurred =
    !(viewer.assetId === assetId && viewer.revealed) &&
    shouldBlurImage(safety.data?.status, preferences.blurNsfw, details, preferences.blurDetails);

  const intercept = (event: SyntheticEvent) => {
    if (!blurred) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const reveal = (event: SyntheticEvent) => {
    if (!blurred) return;
    intercept(event);
    setViewer({ assetId, revealed: true });
  };

  return { safety, blurred, intercept, reveal };
}

/** Retains the existing image element and layout while consuming the first reveal gesture. */
export function SafetyImage({
  assetId,
  details = false,
  safetyDisabled = false,
  ...props
}: ComponentProps<"img"> & {
  assetId: string | null;
  details?: boolean;
  safetyDisabled?: boolean;
}) {
  useTranslation();
  const display = useSafetyDisplay(safetyDisabled ? null : assetId, details);
  // The image becomes a keyboard-operable reveal button only while its verdict requires blur.
  /* oxlint-disable jsx-a11y/no-noninteractive-element-interactions */
  return (
    <img
      {...props}
      className={`${props.className ?? ""}${display.blurred ? " image-safety-blurred" : ""}`}
      title={display.blurred ? t("safety.reveal") : props.title}
      aria-label={display.blurred ? t("safety.reveal") : props["aria-label"]}
      role={display.blurred ? "button" : props.role}
      tabIndex={display.blurred ? 0 : props.tabIndex}
      onPointerDownCapture={(event) => {
        display.intercept(event);
        if (!display.blurred) props.onPointerDownCapture?.(event);
      }}
      onClickCapture={(event) => {
        display.reveal(event);
        if (!display.blurred) props.onClickCapture?.(event);
      }}
      onKeyDown={(event) => {
        if (display.blurred && (event.key === "Enter" || event.key === " ")) display.reveal(event);
        else props.onKeyDown?.(event);
      }}
    />
  );
}
