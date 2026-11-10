/** Static component utilities use low-specificity defaults and explicit interaction states. */
export const uiStyles = {
  toggle:
    "[:where(&)]:[font:inherit] focus-visible:outline-2 focus-visible:outline-(--accent) focus-visible:outline-offset-2 disabled:opacity-45 disabled:cursor-default [:where(&)]:relative [:where(&)]:inline-flex [:where(&)]:shrink-0 [:where(&)]:items-center [:where(&)]:rounded-full [:where(&)]:border-0 [:where(&)]:p-0 [:where(&)]:cursor-pointer [:where(&)]:[width:28px] [:where(&)]:[height:16px] [:where(&)]:[min-height:16px] [:where(&)]:bg-(--line) [:where(&)]:justify-start [:where(&)]:gap-0 [&[data-checked]]:bg-(--accent-fill) [&:hover:not(:disabled)]:bg-(--line) [&[data-checked]:hover:not(:disabled)]:bg-(--accent-fill)",
  "toggle-thumb":
    "[:where(&)]:block [:where(&)]:[width:12px] [:where(&)]:[height:12px] [:where(&)]:[margin-left:2px] [:where(&)]:[border-radius:50%] [:where(&)]:bg-(--muted) [:where(&)]:[transition:transform_0.1s] [.toggle[data-checked]_&]:[transform:translateX(12px)] [.toggle[data-checked]_&]:[background:#fff]",
  "file-picker": "[:where(&)]:inline-flex [:where(&)]:items-center",
  "select-trigger":
    '[:where(&)]:w-full [:where(&)]:min-w-0 [:where(&)]:justify-between [:where(&)]:bg-(--input) [:where(&)]:text-left [:where(&)]:text-(length:--font-size-label) [:where(&)]:font-normal [.form-field[data-inherited]_.form-control_>_&]:text-(--muted) [&[aria-invalid="true"]]:[border-color:var(--danger)] [&[data-placeholder]]:text-(--muted)',
  "select-value":
    "[:where(&)]:min-w-0 [:where(&)]:overflow-hidden [:where(&)]:text-ellipsis [:where(&)]:whitespace-nowrap",
  "select-icon":
    "[:where(&)]:flex [:where(&)]:text-(--muted) [.select-trigger[data-popup-open]_&]:[transform:rotate(180deg)]",
  "select-positioner": "[:where(&)]:[z-index:70] [:where(&)]:max-w-(--available-width)",
  "select-popup":
    "[:where(&)]:flex [:where(&)]:flex-col [:where(&)]:max-h-(--available-height) [:where(&)]:min-w-(--anchor-width) [:where(&)]:[max-width:min(440px,_var(--available-width))] [:where(&)]:[border:1px_solid_var(--line)] [:where(&)]:rounded-(--overlay-radius) [:where(&)]:bg-(--raised) [:where(&)]:text-(--text) [:where(&)]:shadow-(--shadow) [:where(&)]:outline-none",
  "select-list":
    "[:where(&)]:min-h-0 [:where(&)]:[max-height:min(360px,_var(--available-height))] [:where(&)]:p-(--space-1) [:where(&)]:overflow-y-auto [:where(&)]:overscroll-contain",
  "select-group-label":
    "[:where(&)]:[padding:7px_var(--space-3)_var(--space-1)] [:where(&)]:text-(--muted) [:where(&)]:text-(length:--font-size-caption)",
  "select-option":
    "[:where(&)]:flex [:where(&)]:items-center [:where(&)]:justify-between [:where(&)]:gap-(--space-4) [:where(&)]:min-h-(--control-height) [:where(&)]:[padding:5px_var(--space-3)] [:where(&)]:rounded-(--radius) [:where(&)]:text-(length:--font-size-label) [:where(&)]:cursor-default [:where(&)]:outline-none [:where(&)]:wrap-anywhere [&[data-highlighted]]:bg-(--accent-soft) [&[data-highlighted]]:text-(--accent) [&[data-disabled]]:opacity-45",
  "select-check":
    "[:where(&)]:flex [:where(&)]:shrink-0 [:where(&)]:ml-auto [:where(&)]:text-(--accent)",
  "select-footer":
    "[:where(&)]:shrink-0 [:where(&)]:[border-top:1px_solid_var(--line-subtle)] [:where(&)]:p-(--space-1) [:where(&)]:flex [:where(&)]:justify-end",
  "tag-input-root": "[:where(&)]:min-w-0 [:where(&)]:w-full",
  "tag-input":
    "[:where(&)]:flex [:where(&)]:items-center [:where(&)]:flex-wrap [:where(&)]:gap-(--space-1) [:where(&)]:min-h-(--control-height) [:where(&)]:[padding:var(--space-1)_var(--space-2)] [:where(&)]:[border:1px_solid_var(--line)] [:where(&)]:rounded-(--radius) [:where(&)]:bg-(--input) [:where(&)]:text-(length:--font-size-label) [:where(&)]:cursor-text [&:focus-within]:[border-color:var(--accent)] [&[data-invalid]]:[border-color:var(--danger)] [&[data-disabled]]:opacity-45 [&[data-disabled]]:cursor-default [&:has(input:disabled)]:opacity-45 [&:has(input:disabled)]:cursor-default",
  "tag-input-chip":
    "[:where(&)]:inline-flex [:where(&)]:items-center [:where(&)]:gap-(--space-1) [:where(&)]:min-w-0 [:where(&)]:max-w-full [:where(&)]:pl-(--space-2) [:where(&)]:rounded-(--radius) [:where(&)]:bg-(--accent-soft) [:where(&)]:text-(--accent) [:where(&)]:[line-height:22px] [:where(&)]:cursor-default [&:focus-visible]:[outline:2px_solid_var(--accent)] [&:focus-visible]:[outline-offset:2px]",
  "tag-input-chip-label":
    "[:where(&)]:overflow-hidden [:where(&)]:text-ellipsis [:where(&)]:whitespace-nowrap",
  "tag-input-remove":
    "[:where(&)]:inline-flex [:where(&)]:items-center [:where(&)]:justify-center [:where(&)]:cursor-pointer focus-visible:outline-2 focus-visible:outline-(--accent) focus-visible:outline-offset-2 disabled:opacity-45 [:where(&)]:shrink-0 [:where(&)]:[width:22px] [:where(&)]:[height:22px] [:where(&)]:[min-height:22px] [:where(&)]:p-0 [:where(&)]:border-0 [:where(&)]:[background:transparent]",
  "tag-input-draft":
    "[.tag-input_&]:[flex:1_1_100px] [.tag-input_&]:[width:100px] [.tag-input_&]:[height:24px] [.tag-input_&]:[min-width:40px] [.tag-input_&]:[padding:0_var(--space-1)] [.tag-input_&]:border-0 [.tag-input_&]:[border-radius:0] [.tag-input_&]:[background:transparent] [.tag-input_&:focus-visible]:outline-none [.tag-input_&:disabled]:[opacity:1]",
};
