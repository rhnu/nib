/** Reveal the owning fragment before focusing its persistent editor. */
export function focusPromptEditor(root: HTMLElement): boolean {
  const editor = root.matches('[role="textbox"], textarea')
    ? root
    : root.querySelector<HTMLElement>('[role="textbox"], textarea');
  if (!editor) return false;
  editor
    .closest("[data-prompt-node-id]")
    ?.querySelector<HTMLElement>('[data-prompt-expand][aria-expanded="false"]')
    ?.click();
  requestAnimationFrame(() => {
    if (!editor.isConnected) return;
    editor.scrollIntoView({ block: "nearest" });
    editor.focus();
  });
  return true;
}
