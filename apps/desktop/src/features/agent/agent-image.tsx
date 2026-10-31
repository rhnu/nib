import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, RefreshCw } from "lucide-react";
import { Button, IconButton, Modal, Notice } from "@/shared/ui";
import { t } from "@/shared/i18n";
import { useMediaContent } from "@/features/media/use-media-content";
import { SafetyImage } from "@/features/media/safety-image";
import { mediaApi } from "@/features/media/api";
import { errorMessage } from "@/shared/host/error";

/** Chat thumbnails and full-size inspection share the application's media and safety readers. */
export function AgentImage({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const thumbnail = useMediaContent(id, "image/png", true, "thumbnail");
  const asset = useQuery({
    queryKey: ["media-asset", id],
    queryFn: () => mediaApi.asset(id),
    enabled: open,
  });
  const original = useMediaContent(
    open && asset.data ? id : null,
    asset.data?.mimeType ?? "image/png",
    asset.data?.available ?? false,
  );
  return (
    <div className="agent-image-item">
      <Button
        className="agent-image"
        onClick={() => setOpen(true)}
        aria-label={t("agent.viewImage")}
      >
        {thumbnail.url ? (
          <SafetyImage
            assetId={id}
            src={thumbnail.url}
            alt={t("agent.attachedImage")}
            onError={thumbnail.failed}
          />
        ) : thumbnail.error ? (
          <ImageOff size={22} aria-hidden />
        ) : (
          t("media.loadingImage")
        )}
      </Button>
      {thumbnail.error && (
        <output className="agent-image-error">
          <span title={thumbnail.error}>{t("generation.loadFailed")}</span>
          <IconButton label={t("media.retryRead")} onClick={thumbnail.retry}>
            <RefreshCw size={13} aria-hidden />
          </IconButton>
        </output>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t("agent.viewImage")} wide>
        {original.url ? (
          <SafetyImage
            className="agent-image-full"
            assetId={id}
            details
            src={original.url}
            alt={t("agent.attachedImage")}
            onError={original.failed}
          />
        ) : original.error || asset.error || asset.data?.available === false ? (
          <Notice
            actions={
              <Button
                onClick={() => {
                  void asset.refetch();
                  original.retry();
                }}
              >
                {t("media.retryRead")}
              </Button>
            }
          >
            {original.error ??
              (asset.error ? errorMessage(asset.error) : t("media.imageFileMissing"))}
          </Notice>
        ) : (
          t("media.loadingImage")
        )}
      </Modal>
    </div>
  );
}
