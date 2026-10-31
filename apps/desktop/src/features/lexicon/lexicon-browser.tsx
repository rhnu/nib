import { useState } from "react";
import type { PromptSyntaxProfile } from "@/bindings/prompt";
import { Modal } from "@/shared/ui";
import { t, useTranslation } from "@/shared/i18n";
import { useWorkbenchContext } from "@/features/workbench/workbench-context";
import { createLexiconSessionStore } from "./lexicon-session";
import { LexiconWorkspace, type LexiconInsert } from "./lexicon-workspace";

/** Quick insertion keeps the originating CodeMirror view and its selection alive. */
export function LexiconBrowser({
  open,
  onClose,
  onInsert,
  profile,
  readOnly,
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  onInsert?: LexiconInsert;
  profile?: PromptSyntaxProfile;
  readOnly: boolean;
  returnFocus?: () => HTMLElement | null;
}) {
  useTranslation();
  const { openDownloads } = useWorkbenchContext();
  const [store] = useState(createLexiconSessionStore);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t("lexicon.title")}
      wide
      className="lexicon-modal"
      finalFocus={returnFocus}
      showClose={!busy}
    >
      <LexiconWorkspace
        store={store}
        profile={profile}
        readOnly={readOnly}
        onInsert={onInsert}
        onInserted={onClose}
        onBusy={setBusy}
        onOpenDownloads={() => {
          void openDownloads().then((opened) => {
            if (opened) onClose();
          });
        }}
      />
    </Modal>
  );
}
