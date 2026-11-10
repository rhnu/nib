/** Static component utilities use low-specificity defaults and explicit interaction states. */
export const uiStyles = {
  "modal-backdrop":
    "[:where(&)]:fixed [:where(&)]:[inset:var(--titlebar-height)_0_0] [:where(&)]:[background:#0008] [:where(&)]:[z-index:30] [:where(&)]:[backdrop-filter:blur(3px)]",
  modal:
    "[:where(&)]:fixed [:where(&)]:[z-index:31] [:where(&)]:[top:calc(50%_+_var(--titlebar-height)_/_2)] [:where(&)]:[left:50%] [:where(&)]:[transform:translate(-50%,_-50%)] [:where(&)]:[max-height:calc(100dvh_-_var(--titlebar-height)_-_48px)] [:where(&)]:bg-(--surface) [:where(&)]:text-(--text) [:where(&)]:[border:1px_solid_var(--line)] [:where(&)]:rounded-(--overlay-radius) [:where(&)]:shadow-(--shadow)",
  "modal-header":
    "[:where(&)]:flex [:where(&)]:justify-between [:where(&)]:items-center [:where(&)]:mb-(--space-3) [:where(&)]:gap-2.5 [:where(&)]:min-h-7 [&_h2]:text-(length:--font-size-title) [&_h2]:font-semibold [&_h2]:m-0 [.modal-wide_&]:[padding:var(--space-2)_var(--space-4)] [.modal-wide_&]:[border-bottom:1px_solid_var(--line-subtle)] [.modal-wide_&]:m-0 [&_>_.icon-button]:w-(--control-height-compact) [&_>_.icon-button]:min-h-(--control-height-compact) [&_>_.icon-button]:h-(--control-height-compact)",
  "modal-wide":
    "[:where(&)]:[width:min(980px,_calc(100vw_-_48px))] [:where(&)]:[height:min(690px,_calc(100dvh_-_var(--titlebar-height)_-_48px))] [:where(&)]:p-0 [:where(&)]:flex [:where(&)]:flex-col [:where(&)]:overflow-hidden [@media(max-width:760px)]:[&]:[width:calc(100vw_-_24px)] [@media(max-width:760px)]:[&]:[height:calc(100dvh_-_var(--titlebar-height)_-_24px)] [@media(max-width:760px)]:[&]:[max-height:none]",
  "confirm-copy": "[:where(&)]:text-(--muted) [:where(&)]:[line-height:1.8]",
  "menu-positioner": "[:where(&)]:[z-index:50]",
  "menu-popup":
    "[:where(&)]:p-(--space-1) [:where(&)]:[min-width:165px] [:where(&)]:[border:1px_solid_var(--line)] [:where(&)]:rounded-(--overlay-radius) [:where(&)]:p-(--space-1) [:where(&)]:bg-(--raised) [:where(&)]:shadow-(--shadow) [:where(&)]:outline-none [:where(&)]:[max-height:var(--available-height,_80vh)] [:where(&)]:overflow-y-auto",
  "menu-item":
    "[:where(&)]:flex [:where(&)]:items-center [:where(&)]:justify-between [:where(&)]:gap-(--space-6) [:where(&)]:rounded-(--radius) [:where(&)]:text-(length:--font-size-label) [:where(&)]:[padding:7px_10px] [:where(&)]:cursor-default [:where(&)]:outline-none [&[data-highlighted]]:bg-(--hover) [&[data-disabled]]:text-(--muted) [&[data-disabled]]:opacity-45 [&.danger]:[border-top:1px_solid_var(--line-subtle)] [&.danger]:[margin-top:3px]",
  "menu-separator":
    "[:where(&)]:[height:1px] [:where(&)]:[margin:var(--space-1)_2px] [:where(&)]:bg-(--line-subtle)",
  "menu-shortcut": "[:where(&)]:text-(--muted) [:where(&)]:text-(length:--font-size-caption)",
  "help-marker":
    "[:where(&)]:text-(--muted) [:where(&)]:w-(--control-height-compact) [:where(&)]:min-h-(--control-height-compact)",
  "help-positioner": "[:where(&)]:[z-index:70]",
  "help-popup":
    "[:where(&)]:px-(--space-4) [:where(&)]:[width:min(300px,_calc(100vw_-_24px))] [:where(&)]:[padding:10px_var(--space-4)] [:where(&)]:[border:1px_solid_var(--line)] [:where(&)]:rounded-(--overlay-radius) [:where(&)]:bg-(--raised) [:where(&)]:text-(--muted) [:where(&)]:shadow-(--shadow) [:where(&)]:text-(length:--font-size-label) [:where(&)]:[line-height:1.7] [&_header]:flex [&_header]:items-center [&_header]:justify-between [&_header]:gap-(--space-4) [&_h2]:text-(--text) [&_h2]:text-(length:--font-size-label) [&_p:last-child]:[margin-bottom:0] [&_header_>_.icon-button]:w-(--control-height-compact) [&_header_>_.icon-button]:min-h-(--control-height-compact) [&_header_>_.icon-button]:h-(--control-height-compact) [&_header]:min-h-(--control-height-compact) [&_header]:mb-(--space-1)",
  "notification-viewport":
    "[:where(&)]:fixed [:where(&)]:[right:20px] [:where(&)]:[bottom:20px] [:where(&)]:[z-index:1500] [:where(&)]:flex [:where(&)]:flex-col [:where(&)]:[gap:8px] [:where(&)]:[width:min(360px,_calc(100vw_-_40px))]",
  notification:
    '[:where(&)]:flex [:where(&)]:items-center [:where(&)]:justify-between [:where(&)]:[gap:12px] [:where(&)]:[padding:12px] [:where(&)]:[border:1px_solid_var(--line)] [:where(&)]:[border-radius:4px] [:where(&)]:bg-(--surface) [:where(&)]:text-(--text) [:where(&)]:[box-shadow:0_4px_16px_#0003] [:where(&)]:wrap-anywhere [&[data-severity="error"]]:[border-color:var(--danger)] [&[data-limited]]:hidden [&[data-ending-style]]:hidden',
};
