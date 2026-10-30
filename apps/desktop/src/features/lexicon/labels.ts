import type { LexiconKind, LexiconMatch } from "@/bindings/lexicon";
import { t } from "@/shared/i18n";

export const lexiconKinds: LexiconKind[] = ["general", "artist", "copyright", "character", "meta"];

export function kindLabel(kind: LexiconKind) {
  const labels = {
    general: t("lexicon.general"),
    artist: t("lexicon.artist"),
    copyright: t("lexicon.copyright"),
    character: t("lexicon.character"),
    meta: t("lexicon.meta"),
  };
  return labels[kind];
}

export function reasonLabel(reason: LexiconMatch["reason"]) {
  const labels = {
    name: t("lexicon.nameMatch"),
    alias: t("lexicon.aliasMatch"),
    translation: t("lexicon.translationMatch"),
    semantic: t("lexicon.semanticMatch"),
    related: t("lexicon.relatedMatch"),
  };
  return labels[reason];
}
