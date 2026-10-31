import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MediaContentStore, type ContentSnapshot } from "@/features/media/content-store";
import { ImageOff, RotateCcw } from "lucide-react";
import type { ExploreMediaVariant, ExploreSummary } from "@/bindings/explore";
import { SafetyPreferencesContext } from "@/features/media/safety-image";
import { t, useTranslation } from "@/shared/i18n";
import { IconButton } from "@/shared/ui/button";
import { exploreApi } from "./api";

const contents = new MediaContentStore((url) => URL.revokeObjectURL(url));
const absent: ContentSnapshot = { url: null, error: null, loading: false };

const noSubscription = () => () => {};

const noSnapshot = () => absent;

/** Remote media stays transient; reading a thumbnail never creates a local asset. */
export function ExploreImage({
  item,
  variant = "thumbnail",
  details = false,
  onOpen,
  openLabel,
}: {
  item: ExploreSummary;
  variant?: ExploreMediaVariant;
  details?: boolean;
  onOpen?: () => void;
  openLabel?: string;
}) {
  useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(details);
  const [revealed, setRevealed] = useState(false);
  const preferences = useContext(SafetyPreferencesContext);
  useEffect(() => {
    const node = root.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);
  const identity = JSON.stringify(item.key);
  const resource = useMemo(
    () =>
      visible
        ? contents.resource(`${variant}:${identity}`, async () => {
            const bytes = await exploreApi.media(item.key, variant);
            return URL.createObjectURL(new Blob([bytes]));
          })
        : null,
    [identity, item.key, variant, visible],
  );
  const media = useSyncExternalStore(
    resource?.subscribe ?? noSubscription,
    resource?.getSnapshot ?? noSnapshot,
  );
  // Site ratings are only a display hint; they never enter local safety evidence.
  const unsafe = item.rating === "questionable" || item.rating === "explicit";
  const blurred =
    unsafe && preferences.blurNsfw && (!details || preferences.blurDetails) && !revealed;
  return (
    <div ref={root} className={`explore-image ${details ? "is-detail" : ""}`}>
      {media.error ? (
        <div className="explore-media-failure">
          <ImageOff size={24} aria-hidden />
          <span>{t("explore.mediaFailed")}</span>
          <IconButton
            label={t("explore.retryMedia")}
            onClick={() => {
              resource?.retry();
            }}
          >
            <RotateCcw size={16} aria-hidden />
          </IconButton>
        </div>
      ) : (
        <button
          className="explore-image-button"
          type="button"
          disabled={!onOpen && !blurred}
          onClick={() => (blurred ? setRevealed(true) : onOpen?.())}
          aria-label={
            blurred
              ? t("safety.reveal")
              : (openLabel ?? t("explore.inspectImage", { title: item.title }))
          }
          title={blurred ? t("safety.reveal") : undefined}
        >
          {media.url ? (
            <img
              src={media.url}
              alt={item.title}
              width={item.width || undefined}
              height={item.height || undefined}
              className={blurred ? "image-safety-blurred" : undefined}
              onError={resource?.failed}
            />
          ) : (
            <span className="explore-image-loading" aria-label={t("explore.loadingMedia")} />
          )}
          {blurred && <span className="explore-blur-label">{t("safety.reveal")}</span>}
        </button>
      )}
    </div>
  );
}
