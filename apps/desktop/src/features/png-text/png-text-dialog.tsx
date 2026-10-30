import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { useEffect, useRef, useState } from "react";
import type { MediaAsset, PngTextInspection } from "@/bindings/media";
import type { PngTextEditorState, PngTextSession, PngTextValue } from "@/bindings/workbench";
import { trackPendingWork } from "@/shared/host/pending-work";
import { errorMessage } from "@/shared/host/error";
import { Button, Field, HelpMarker, Modal, Notice } from "@/shared/ui";
import { mediaApi } from "@/features/media/api";
import { imageName, imageUnavailableReason } from "@/features/media/model";
import { useMediaAsset } from "@/features/media/use-media-asset";
import { useMediaQuery } from "@/features/media/use-media-query";
import { downloadBytes } from "@/features/vibes/model";
import { pngTextApi } from "./api";
import { editPngTextEntry, pngTextSession, storePngTextSession } from "./model";
import "./png-text.css";

export type PngTextController = {
  readState: () => PngTextEditorState;
  /** Update the live draft synchronously; a returned promise covers its persistence. */
  onChange: (state: PngTextEditorState) => void | Promise<void>;
  onUseImage?: (asset: MediaAsset) => void | Promise<void>;
};

type PngTextDialogProps = PngTextController & {
  asset: MediaAsset;
  onClose: () => void;
};

function TextInspection({
  report,
  onEdit,
  disabled,
}: {
  report: PngTextInspection;
  onEdit?: (entry: PngTextValue) => void;
  disabled?: boolean;
}) {
  useTranslation();

  return (
    <div className="png-text-inspection">
      {report.warnings.length > 0 && (
        <ul className="media-notices" aria-label={t("png-text.notice")}>
          {report.warnings.map((warning, index) => (
            <li key={index}>{errorMessage(warning)}</li>
          ))}
        </ul>
      )}
      {report.entries.length === 0 ? (
        <p className="muted">{t("png-text.noEntries")}</p>
      ) : (
        report.entries.map((entry, index) => (
          <details className="png-text-inspection-entry" key={index}>
            <summary>{entry.keyword}</summary>
            <pre>{entry.text === "" ? t("png-text.emptyText") : entry.text}</pre>
            {onEdit && (
              <Button disabled={disabled} onClick={() => onEdit(entry)}>
                {t("png-text.editKeyword")}
              </Button>
            )}
          </details>
        ))
      )}
    </div>
  );
}

function PngTextDialogContent({
  asset,
  onClose,
  readState,
  onChange,
  onUseImage,
}: PngTextDialogProps) {
  useTranslation();

  const session = pngTextSession(readState(), asset.id);
  const unavailable =
    imageUnavailableReason(asset) ??
    (asset.mimeType !== "image/png" ? t("png-text.pngRequired") : null);
  const original = useMediaQuery(
    ["media", "png-text", asset.id],
    unavailable ? null : asset.id,
    pngTextApi.inspect,
  );
  const output = useMediaAsset(session.selectedOutputAssetId);
  const outputUnavailable = output.asset ? imageUnavailableReason(output.asset) : null;
  const written = useMediaQuery(
    ["media", "png-text", output.asset?.id],
    output.asset && !outputUnavailable ? output.asset.id : null,
    pngTextApi.inspect,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState();
  const current = useRef({ active: true, locked: false });
  const callbacks = useRef({ readState, onChange, onUseImage });
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    callbacks.current = { readState, onChange, onUseImage };
  }, [readState, onChange, onUseImage]);
  useEffect(() => {
    const state = current.current;
    state.active = true;
    return () => {
      state.active = false;
    };
  }, []);

  const readSession = () => pngTextSession(callbacks.current.readState(), asset.id);

  const persist = (value: PngTextSession) =>
    callbacks.current.onChange(storePngTextSession(callbacks.current.readState(), value));

  const edit = (entries: PngTextValue[]) => {
    setError(null);
    const next = { ...readSession(), entries };
    try {
      void trackPendingWork(Promise.resolve(persist(next))).catch((cause: unknown) => {
        if (current.current.active && readSession() === next) setError(cause);
      });
    } catch (cause) {
      setError(cause);
    }
  };

  const editOriginal = (entry: PngTextValue) => {
    const next = editPngTextEntry(readSession().entries, entry);
    edit(next.entries);
    requestAnimationFrame(() => {
      if (current.current.active) editor.current?.querySelectorAll("textarea")[next.index]?.focus();
    });
  };

  const run = async (action: () => Promise<void>) => {
    if (current.current.locked) return;
    current.current.locked = true;
    setBusy(true);
    setError(null);
    try {
      await trackPendingWork(action());
    } catch (cause) {
      if (current.current.active) setError(cause);
    } finally {
      current.current.locked = false;
      if (current.current.active) setBusy(false);
    }
  };

  const write = () =>
    run(async () => {
      const input = readSession();
      const result = await mediaApi.writePngText(
        asset.id,
        input.entries.map(({ keyword, text }) => [keyword, text]),
      );
      if (!current.current.active || readSession() !== input) return;
      await persist({ ...input, selectedOutputAssetId: result.id });
    });

  return (
    <Modal open onClose={onClose} title={t("png-text.title")} wide>
      <div className="png-text-dialog">
        <p className="media-asset-heading">{imageName(asset)}</p>
        {unavailable && <Notice>{unavailable}</Notice>}
        <section aria-label={t("png-text.sourcePngText")}>
          <h3>{t("png-text.sourceText")}</h3>
          {original.loading && <output>{t("png-text.loadingText")}</output>}
          {original.error && (
            <Notice actions={<Button onClick={original.retry}>{t("png-text.retryRead")}</Button>}>
              {original.error}
            </Notice>
          )}
          {original.value && (
            <TextInspection report={original.value} onEdit={editOriginal} disabled={busy} />
          )}
        </section>
        <section aria-label={t("png-text.writeContentLabel")}>
          <div className="png-text-heading">
            <h3>{t("png-text.writeContent")}</h3>
            <HelpMarker label={t("png-text.writeRules")}>
              {t("png-text.writeRulesDescription")}
            </HelpMarker>
          </div>
          <div className="png-text-editor" ref={editor}>
            {session.entries.map((entry, index) => (
              <div className="png-text-editor-entry" key={index}>
                <Field label={t("png-text.keywordLabel", { value0: index + 1 })}>
                  <input
                    value={entry.keyword}
                    disabled={busy}
                    onChange={(event) =>
                      edit(
                        readSession().entries.map((value, position) =>
                          position === index ? { ...value, keyword: event.target.value } : value,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label={t("png-text.textLabel", { value0: index + 1 })}>
                  <textarea
                    rows={4}
                    value={entry.text}
                    disabled={busy}
                    onChange={(event) =>
                      edit(
                        readSession().entries.map((value, position) =>
                          position === index ? { ...value, text: event.target.value } : value,
                        ),
                      )
                    }
                  />
                </Field>
                <Button
                  disabled={busy}
                  onClick={() =>
                    edit(readSession().entries.filter((_, position) => position !== index))
                  }
                >
                  {t("png-text.removeWriteEntry")}
                </Button>
              </div>
            ))}
          </div>
          <div className="png-text-actions">
            <Button
              disabled={busy || !!unavailable}
              onClick={() => edit([...readSession().entries, { keyword: "", text: "" }])}
            >
              {t("png-text.addKeyword")}
            </Button>
            <Button
              className="primary"
              disabled={busy || !!unavailable || !original.value || session.entries.length === 0}
              onClick={() => void write()}
            >
              {busy ? t("png-text.processing") : t("png-text.writeNewImage")}
            </Button>
          </div>
        </section>
        {error && <Notice>{error}</Notice>}
        {session.selectedOutputAssetId && (
          <section className="png-text-output" aria-label={t("png-text.writtenPng")}>
            <div className="png-text-heading">
              <h3>{t("png-text.lastWrittenImage")}</h3>
              {output.asset && (
                <Button disabled={busy || written.loading} onClick={written.retry}>
                  {t("png-text.inspectAgain")}
                </Button>
              )}
            </div>
            {output.loading && <output>{t("png-text.loadingNewImage")}</output>}
            {output.error && (
              <Notice actions={<Button onClick={output.retry}>{t("png-text.retryRead")}</Button>}>
                {output.error}
              </Notice>
            )}
            {outputUnavailable && <Notice>{outputUnavailable}</Notice>}
            {output.asset && !outputUnavailable && (
              <>
                <div className="png-text-actions">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const outputId = output.asset!.id;
                        const bytes = await mediaApi.content(outputId);
                        if (
                          current.current.active &&
                          readSession().selectedOutputAssetId === outputId
                        )
                          downloadBytes(bytes, "nib-png-text.png", "image/png");
                      })
                    }
                  >
                    {t("png-text.exportPng")}
                  </Button>
                  {onUseImage && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          if (current.current.active)
                            await callbacks.current.onUseImage?.(output.asset!);
                        })
                      }
                    >
                      {t("png-text.useAsSource")}
                    </Button>
                  )}
                </div>
                {written.loading && <output>{t("png-text.inspectingNewText")}</output>}
                {written.error && (
                  <Notice
                    actions={
                      <Button onClick={written.retry}>{t("png-text.retryInspection")}</Button>
                    }
                  >
                    {written.error}
                  </Notice>
                )}
                {written.value && <TextInspection report={written.value} />}
              </>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}

export function PngTextDialog(props: PngTextDialogProps) {
  useTranslation();

  return <PngTextDialogContent key={props.asset.id} {...props} />;
}
