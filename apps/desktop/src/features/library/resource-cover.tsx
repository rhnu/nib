import { Row } from "@/shared/ui";

import { SafetyImage } from "@/features/media/safety-image";
import { ImageOff, Layers, Link2 } from "lucide-react";
import { useMediaContent } from "@/features/media/use-media-content";

/** Covers use the shared immutable thumbnail cache and never reference a gallery record. */
export function ResourceCover({
  assetId,
  name,
  kind = "chunk",
}: {
  assetId: string | null;
  name: string;
  kind?: "chunk" | "preset";
}) {
  const image = useMediaContent(assetId, "image/png", !!assetId, "thumbnail");
  return (
    <Row
      gap={0}
      className="resource-cover [&_img]:w-full [&_img]:h-full [&_img]:object-cover flex items-center justify-center overflow-hidden bg-panel text-muted"
    >
      {image.url ? (
        <SafetyImage assetId={assetId} src={image.url} alt={name} onError={image.failed} />
      ) : image.error ? (
        <ImageOff aria-label={image.error} size={25} />
      ) : kind === "chunk" ? (
        <Link2 size={30} aria-hidden />
      ) : (
        <Layers size={30} aria-hidden />
      )}
    </Row>
  );
}
