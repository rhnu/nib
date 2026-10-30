import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`ui-button inline-flex items-center justify-center gap-1.5 ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <Button className={`icon-button ${className}`} title={label} aria-label={label} {...props}>
      {children}
    </Button>
  );
}
