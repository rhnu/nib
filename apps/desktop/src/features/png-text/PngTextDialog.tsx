import { useEffect, useRef, useState } from "react";
import type { MediaAsset, PngTextInspection } from "../../bindings/media";
import type { PngTextEditorState, PngTextSession, PngTextValue } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { trackPendingWork } from "../../shared/host/pending-work";
import { Button, Field, HelpMarker, Modal, Notice } from "../../shared/ui";
import { mediaApi } from "../media/api";
import { imageName, imageUnavailableReason } from "../media/model";
import { useMediaAsset } from "../media/useMediaAsset";
import { useMediaQuery } from "../media/useMediaQuery";
import { downloadBytes } from "../vibes/model";
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
  return (
    <div className="png-text-inspection">
      {report.warnings.length > 0 && (
        <ul className="media-notices" aria-label="PNG 文本提示">
          {report.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}
      {report.entries.length === 0 ? (
        <p className="muted">没有 PNG 文本条目</p>
      ) : (
        report.entries.map((entry, index) => (
          <details className="png-text-inspection-entry" key={index}>
            <summary>{entry.keyword}</summary>
            <pre>{entry.text === "" ? "（空文本）" : entry.text}</pre>
            {onEdit && (
              <Button disabled={disabled} onClick={() => onEdit(entry)}>
                编辑此关键字
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
  const session = pngTextSession(readState(), asset.id);
  const unavailable =
    imageUnavailableReason(asset) ??
    (asset.mimeType !== "image/png" ? "PNG 文本操作需要 PNG 图片。" : null);
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
  const [error, setError] = useState<string | null>(null);
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
        if (current.current.active && readSession() === next) setError(errorMessage(cause));
      });
    } catch (cause) {
      setError(errorMessage(cause));
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
      if (current.current.active) setError(errorMessage(cause));
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
    <Modal open onClose={onClose} title="PNG 文本" wide>
      <div className="png-text-dialog">
        <p className="media-asset-heading">{imageName(asset)}</p>
        {unavailable && <Notice>{unavailable}</Notice>}
        <section aria-label="原图 PNG 文本">
          <h3>原图文本</h3>
          {original.loading && <output>正在读取 PNG 文本…</output>}
          {original.error && (
            <Notice actions={<Button onClick={original.retry}>重试读取</Button>}>
              {original.error}
            </Notice>
          )}
          {original.value && (
            <TextInspection report={original.value} onEdit={editOriginal} disabled={busy} />
          )}
        </section>
        <section aria-label="PNG 文本写入内容">
          <div className="png-text-heading">
            <h3>写入内容</h3>
            <HelpMarker label="PNG 文本写入规则">
              已有关键字按 ASCII
              大小写不敏感匹配，替换其全部同名条目；新关键字追加。未填写的关键字保持原样。空文本会写入空值，不会删除原条目。像素与原图保持不变，写入后另存为新图片。
            </HelpMarker>
          </div>
          <div className="png-text-editor" ref={editor}>
            {session.entries.map((entry, index) => (
              <div className="png-text-editor-entry" key={index}>
                <Field label={`关键字 ${index + 1}`}>
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
                <Field label={`文本 ${index + 1}`}>
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
                  移除此项写入
                </Button>
              </div>
            ))}
          </div>
          <div className="png-text-actions">
            <Button
              disabled={busy || !!unavailable}
              onClick={() => edit([...readSession().entries, { keyword: "", text: "" }])}
            >
              添加关键字
            </Button>
            <Button
              className="primary"
              disabled={busy || !!unavailable || !original.value || session.entries.length === 0}
              onClick={() => void write()}
            >
              {busy ? "正在处理…" : "写入新图片"}
            </Button>
          </div>
        </section>
        {error && <Notice>{error}</Notice>}
        {session.selectedOutputAssetId && (
          <section className="png-text-output" aria-label="写入后的 PNG">
            <div className="png-text-heading">
              <h3>最近写入的图片</h3>
              {output.asset && (
                <Button disabled={busy || written.loading} onClick={written.retry}>
                  再次检查
                </Button>
              )}
            </div>
            {output.loading && <output>正在读取新图片…</output>}
            {output.error && (
              <Notice actions={<Button onClick={output.retry}>重试读取</Button>}>
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
                    导出 PNG
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
                      用作底图
                    </Button>
                  )}
                </div>
                {written.loading && <output>正在检查新图片的 PNG 文本…</output>}
                {written.error && (
                  <Notice actions={<Button onClick={written.retry}>重试检查</Button>}>
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
  return <PngTextDialogContent key={props.asset.id} {...props} />;
}
