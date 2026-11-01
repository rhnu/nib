type MenuRequest = {
  type: string;
  button?: number;
  pointerType?: string;
  key?: string;
  shiftKey?: boolean;
  isComposing?: boolean;
};

/** Only secondary-button, touch and explicit keyboard requests open the text menu. */
export function isTextMenuRequest(event: MenuRequest): boolean {
  if (event.type === "keydown")
    return (
      !event.isComposing &&
      (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey === true))
    );
  return event.type === "contextmenu" && (event.button === 2 || event.pointerType === "touch");
}
