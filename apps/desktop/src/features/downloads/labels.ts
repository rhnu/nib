import { formatNumber, t } from "@/shared/i18n";

export function resourceName(id: string, fallback: string) {
  if (id === "anime-dbrating") return t("safety.ratingModelName");
  if (id === "wd-swinv2-tagger-v3") return t("safety.tagModelName");
  return id === "lexicon" ? t("downloads.lexiconName") : fallback;
}

export function resourceDescription(id: string, fallback: string) {
  if (id === "anime-dbrating") return t("safety.ratingModelDescription");
  if (id === "wd-swinv2-tagger-v3") return t("safety.tagModelDescription");
  return id === "lexicon" ? t("downloads.lexiconDescription") : fallback;
}

export function componentName(resourceId: string, id: string, fallback: string) {
  if ((resourceId === "anime-dbrating" || resourceId === "wd-swinv2-tagger-v3") && id === "core")
    return t("safety.modelFiles");
  if (resourceId === "lexicon" && id === "core") return t("downloads.coreName");
  if (resourceId === "lexicon" && id === "semantic") return t("downloads.semanticName");
  return fallback;
}

export function componentDescription(resourceId: string, id: string, fallback: string) {
  if (resourceId === "anime-dbrating" && id === "core") return t("safety.ratingModelDescription");
  if (resourceId === "wd-swinv2-tagger-v3" && id === "core") return t("safety.tagModelDescription");
  if (resourceId === "lexicon" && id === "core") return t("downloads.coreDescription");
  if (resourceId === "lexicon" && id === "semantic") return t("downloads.semanticDescription");
  return fallback;
}

export function formatBytes(bytes: number) {
  const unit =
    bytes >= 1024 ** 3 ? "GiB" : bytes >= 1024 ** 2 ? "MiB" : bytes >= 1024 ? "KiB" : "B";
  const scale = unit === "GiB" ? 1024 ** 3 : unit === "MiB" ? 1024 ** 2 : unit === "KiB" ? 1024 : 1;
  return `${formatNumber(bytes / scale, { maximumFractionDigits: scale === 1 ? 0 : 1 })} ${unit}`;
}
