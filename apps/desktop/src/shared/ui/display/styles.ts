/** Static component utilities use low-specificity defaults and explicit interaction states. */
export const uiStyles = {
  "error-banner":
    "[:where(&)]:[padding:var(--space-3)_15px] [:where(&)]:flex [:where(&)]:items-center [:where(&)]:[gap:10px] [:where(&)]:bg-(--danger-bg) [:where(&)]:text-(--danger) [:where(&)]:text-(length:--font-size-label) [:where(&)]:[border-bottom:1px_solid_color-mix(in_srgb,_var(--danger)_30%,_var(--line))] [:where(&)]:flex-wrap [&_>_span]:flex-1 [&_>_span]:[min-width:100px] [&_button]:[min-height:27px] [&_button]:text-(length:--font-size-caption) [&_button]:[padding-block:2px]",
};
