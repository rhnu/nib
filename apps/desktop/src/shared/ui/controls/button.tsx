import type { ComponentProps, ReactNode } from "react";

export const buttonStyles =
  "[:where(&)]:[font:inherit] [:where(&)]:border-solid [:where(&)]:inline-flex [:where(&)]:items-center [:where(&)]:justify-center [:where(&)]:gap-(--space-2) [:where(&)]:min-h-(--control-height) [:where(&)]:rounded-(--radius) [:where(&)]:border [:where(&)]:border-[var(--button-border,var(--icon-border,var(--line)))] [:where(&)]:bg-[var(--button-bg,var(--icon-bg,var(--raised)))] [:where(&)]:[padding:var(--button-padding,var(--icon-padding,var(--space-1)_var(--space-3)))] [:where(&)]:[color:var(--button-text,inherit)] [:where(&)]:leading-5 [:where(&)]:whitespace-nowrap [:where(&)]:cursor-pointer [:where(&)]:hover:enabled:bg-[var(--button-hover,var(--hover))] [:where(&)]:focus-visible:outline-2 [:where(&)]:focus-visible:outline-(--accent) [:where(&)]:focus-visible:outline-offset-2 [:where(&)]:disabled:opacity-45 [:where(&)]:disabled:cursor-default";
export const iconButtonStyles =
  "[:where(&)]:shrink-0 [:where(&)]:w-(--control-height) [:where(&)]:[--icon-padding:var(--space-1)] [:where(&)]:[--icon-bg:transparent] [:where(&)]:[--icon-border:transparent]";
const variants = {
  default: "",
  primary:
    "[:where(&)]:[--button-bg:var(--accent-fill)] [:where(&)]:[--button-hover:var(--accent-fill)] [:where(&)]:[--button-text:var(--accent-text)] [:where(&)]:[--button-border:var(--accent-fill)] [:where(&)]:hover:enabled:brightness-110",
  quiet: "[:where(&)]:[--button-bg:transparent] [:where(&)]:[--button-border:transparent]",
  danger: "[:where(&)]:[--button-text:var(--danger)] [:where(&)]:[--button-border:var(--danger)]",
};
const activeStyles =
  "[:where(&)]:[--button-bg:var(--accent-soft)] [:where(&)]:[--button-text:var(--accent)] [:where(&)]:[--button-border:var(--accent)]";
type ButtonProps = ComponentProps<"button"> & { variant?: keyof typeof variants; active?: boolean };

/** Product button appearance keeps native events, semantics and references. */
export function Button({
  className = "",
  type = "button",
  variant = "default",
  active = false,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-active={active || undefined}
      className={`ui-button ${buttonStyles}  ${active ? activeStyles : variants[variant]}  ${className}`}
      {...props}
    />
  );
}

/** A pure icon action always has an accessible name and native tooltip. */
export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonProps & { label: string; children?: ReactNode }) {
  return (
    <Button
      className={`icon-button ${iconButtonStyles}  ${className}`}
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </Button>
  );
}
