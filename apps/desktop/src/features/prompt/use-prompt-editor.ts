import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { registerPromptContextMenu } from "./editor-context-menu";
import { formatPromptEditor } from "./editor-format";
import type { FormattingContext } from "./format-context";
import type { PromptDocument } from "@/bindings/prompt";
import {
  createPromptEditor,
  editorCompartments,
  editorConfiguration,
  synchronizePromptValue,
  type EditorConfiguration,
} from "./editor-base";
import {
  setPromptAnalysis,
  setPromptContext,
  setPromptPending,
  setPromptProfile,
} from "./editor-analysis";

/** A view lives for one mount. Configuration and controlled updates retain history and selection. */
export function usePromptEditor(
  configuration: EditorConfiguration,
  document: PromptDocument | null,
  onChange: ((value: string) => void) | undefined,
  onSelection: (position: number) => void,
  onInsertionError: (cause: unknown) => void,
  {
    visible = true,
    sizing = "bounded",
    formattingContext,
  }: {
    visible?: boolean;
    sizing?: "bounded" | "content";
    formattingContext?: () => Promise<FormattingContext>;
  },
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const disabledProbe = useRef<HTMLInputElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const current = useRef({
    configuration,
    document,
    onChange,
    onSelection,
    onInsertionError,
    formattingContext,
  });
  useLayoutEffect(() => {
    current.current = {
      configuration,
      document,
      onChange,
      onSelection,
      onInsertionError,
      formattingContext,
    };
  });
  const [compartments] = useState(editorCompartments);
  const [formatting, setFormatting] = useState(false);
  const formatSession = useRef(0);

  const format = () => {
    const view = viewRef.current;
    const context = current.current.formattingContext;
    if (!view || !context || view.state.readOnly || view.compositionStarted) return;
    const session = ++formatSession.current;

    const valid = () =>
      viewRef.current === view &&
      formatSession.current === session &&
      current.current.formattingContext === context;

    setFormatting(true);
    current.current.onInsertionError("");
    void formatPromptEditor(view, context, valid)
      .catch((cause: unknown) => {
        if (valid()) current.current.onInsertionError(cause);
      })
      .finally(() => {
        if (viewRef.current === view && formatSession.current === session) setFormatting(false);
      });
  };

  const formatRef = useRef(format);
  useLayoutEffect(() => {
    formatRef.current = format;
  });

  useEffect(() => {
    if (!hostRef.current) return;
    let compositionTimer: ReturnType<typeof setTimeout> | undefined;

    const effectiveConfiguration = () => ({
      ...current.current.configuration,
      disabled:
        current.current.configuration.disabled ||
        Boolean(disabledProbe.current?.matches(":disabled")),
    });

    const view = createPromptEditor(
      hostRef.current,
      effectiveConfiguration(),
      compartments,
      (value) => current.current.onChange?.(value),
      (position) => current.current.onSelection(position),
      () => {
        clearTimeout(compositionTimer);
        compositionTimer = setTimeout(() => {
          if (!view.compositionStarted) {
            synchronizePromptValue(view, current.current.configuration.value);
            // The matching result may have arrived while the external value was deferred by IME.
            view.dispatch({
              effects: [
                setPromptContext.of(current.current.configuration.analysisContext),
                setPromptAnalysis.of(current.current.document),
                setPromptProfile.of(current.current.configuration.profile ?? null),
                setPromptPending.of(current.current.configuration.analysisPending),
              ],
            });
          }
        }, 0);
      },
      (cause) => current.current.onInsertionError(cause),
      () => formatRef.current(),
    );
    viewRef.current = view;
    const unregisterContextMenu = registerPromptContextMenu(view);
    const observer = new MutationObserver(() => {
      view.dispatch({
        effects: compartments.configuration.reconfigure(
          editorConfiguration(effectiveConfiguration()),
        ),
      });
    });
    // Native :disabled handles fieldset inheritance, including the first-legend exception.
    for (
      let ancestor = hostRef.current.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      if (ancestor instanceof HTMLFieldSetElement)
        observer.observe(ancestor, { attributes: true, attributeFilter: ["disabled"] });
    }
    return () => {
      clearTimeout(compositionTimer);
      observer.disconnect();
      unregisterContextMenu();
      viewRef.current = null;
      view.destroy();
    };
  }, [compartments]);

  useEffect(() => {
    const view = viewRef.current;
    // compositionStarted includes the interval before the IME's first document change.
    if (view && !view.compositionStarted) synchronizePromptValue(view, configuration.value);
  }, [configuration.value]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.configuration.reconfigure(
        editorConfiguration({
          ...current.current.configuration,
          disabled:
            current.current.configuration.disabled ||
            Boolean(disabledProbe.current?.matches(":disabled")),
        }),
      ),
    });
  }, [
    compartments,
    configuration.disabled,
    configuration.label,
    configuration.descriptionId,
    configuration.placeholder,
    configuration.readOnly,
  ]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.language.reconfigure(
        EditorView.contentAttributes.of({ lang: configuration.language }),
      ),
    });
  }, [compartments, configuration.language]);
  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.dispatch({
        effects: [
          setPromptContext.of(configuration.analysisContext),
          setPromptAnalysis.of(view.state.doc.toString() === configuration.value ? document : null),
          setPromptProfile.of(configuration.profile ?? null),
          setPromptPending.of(configuration.analysisPending),
        ],
      });
    }
  }, [
    configuration.value,
    configuration.profile,
    configuration.analysisContext,
    configuration.analysisPending,
    document,
  ]);

  useLayoutEffect(() => {
    if (!visible) return;
    // A retained view cannot measure its layout while hidden; measure after it is revealed.
    const frame = requestAnimationFrame(() => viewRef.current?.requestMeasure());
    return () => cancelAnimationFrame(frame);
  }, [visible, sizing]);

  return { hostRef, viewRef, disabledProbe, format, formatting };
}
