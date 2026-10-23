import type { PngTextEditorState, PngTextSession, PngTextValue } from "../../bindings/workbench";

export function pngTextSession(state: PngTextEditorState, assetId: string): PngTextSession {
  return (
    state.sessions.find((session) => session.assetId === assetId) ?? {
      assetId,
      entries: [],
      selectedOutputAssetId: null,
    }
  );
}

export function storePngTextSession(
  state: PngTextEditorState,
  session: PngTextSession,
): PngTextEditorState {
  const index = state.sessions.findIndex((value) => value.assetId === session.assetId);
  return {
    sessions:
      index === -1
        ? [...state.sessions, session]
        : state.sessions.map((value, position) => (position === index ? session : value)),
  };
}

/** Opening an existing keyword must not overwrite an already edited replacement. */
export function editPngTextEntry(entries: PngTextValue[], entry: PngTextValue) {
  const fold = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const index = entries.findIndex((value) => fold(value.keyword) === fold(entry.keyword));
  return index === -1
    ? { entries: [...entries, { ...entry }], index: entries.length }
    : { entries, index };
}
