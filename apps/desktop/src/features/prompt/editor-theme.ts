import { EditorView } from "@codemirror/view";

/** CSS variables follow the application theme without replacing editor state. */
export const promptEditorTheme = EditorView.theme({
  "&": { fontSize: "13px", backgroundColor: "var(--input)", color: "var(--text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.75",
    overflow: "auto",
    maxHeight: "320px",
  },
  ".cm-content": {
    minHeight: "88px",
    padding: "7px 32px 7px 9px",
    caretColor: "var(--text)",
    fontVariantLigatures: "contextual",
  },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": { color: "var(--muted)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent-soft)",
  },
  ".cm-tooltip": {
    border: "1px solid var(--line)",
    borderRadius: "var(--radius-overlay)",
    backgroundColor: "var(--raised)",
    color: "var(--text)",
    boxShadow: "var(--shadow)",
  },
});
