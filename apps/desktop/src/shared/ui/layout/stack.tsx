import { createElement, type ComponentPropsWithRef, type CSSProperties, type JSX } from "react";

type LayoutElement = keyof JSX.IntrinsicElements;
type Gap = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type Align = "start" | "center" | "end" | "stretch" | "baseline";
type Justify = "start" | "center" | "end" | "between";
const gaps = [
  "[:where(&)]:gap-0",
  "[:where(&)]:gap-(--space-1)",
  "[:where(&)]:gap-(--space-2)",
  "[:where(&)]:gap-(--space-3)",
  "[:where(&)]:gap-(--space-4)",
  "[:where(&)]:gap-(--space-5)",
  "[:where(&)]:gap-(--space-6)",
];
const aligns = {
  start: "[:where(&)]:items-start",
  center: "[:where(&)]:items-center",
  end: "[:where(&)]:items-end",
  stretch: "[:where(&)]:items-stretch",
  baseline: "[:where(&)]:items-baseline",
};
const justifies = {
  start: "[:where(&)]:justify-start",
  center: "[:where(&)]:justify-center",
  end: "[:where(&)]:justify-end",
  between: "[:where(&)]:justify-between",
};
type LayoutProps<T extends LayoutElement> = {
  as?: T;
  gap?: Gap;
  align?: Align;
  justify?: Justify;
  grow?: boolean;
} & Omit<ComponentPropsWithRef<NoInfer<T>>, "as" | "gap" | "align" | "justify">;
type StackProps<T extends LayoutElement> = LayoutProps<T> & { wrap?: boolean };
type GridProps<T extends LayoutElement> = {
  as?: T;
  gap?: Gap;
  align?: Align;
  minColumnWidth?: number | string;
  columns?: number;
} & Omit<ComponentPropsWithRef<NoInfer<T>>, "as" | "gap" | "align">;

/** Horizontal flow with shared spacing and native element semantics. */
export function Row<T extends LayoutElement = "div">({
  as,
  gap = 2,
  align = "center",
  justify = "start",
  wrap = false,
  grow = false,
  className = "",
  ...props
}: StackProps<T>) {
  return createElement(as ?? "div", {
    ...props,
    className: `ui-row [:where(&)]:flex [:where(&)]:min-w-0 ${gaps[gap]}  ${aligns[align]}  ${justifies[justify]}  ${wrap ? "[:where(&)]:flex-wrap" : "[:where(&)]:flex-nowrap"}  ${grow ? "[:where(&)]:flex-1" : ""}  ${className}`,
  });
}

/** Vertical flow uses the same spacing and alignment vocabulary as Row. */
export function Col<T extends LayoutElement = "div">({
  as,
  gap = 2,
  align = "stretch",
  justify = "start",
  wrap = false,
  grow = false,
  className = "",
  ...props
}: StackProps<T>) {
  return createElement(as ?? "div", {
    ...props,
    className: `ui-col [:where(&)]:flex [:where(&)]:min-w-0 [:where(&)]:flex-col ${gaps[gap]}  ${aligns[align]}  ${justifies[justify]}  ${wrap ? "[:where(&)]:flex-wrap" : "[:where(&)]:flex-nowrap"}  ${grow ? "[:where(&)]:flex-1" : ""}  ${className}`,
  });
}

/** Columns respond to the container's available width, including narrow panels. */
export function Grid<T extends LayoutElement = "div">({
  as,
  gap = 3,
  align = "start",
  minColumnWidth = "12rem",
  columns = 2,
  className = "",
  style,
  ...props
}: GridProps<T>) {
  return createElement(as ?? "div", {
    ...props,
    className: `ui-grid [:where(&)]:grid [:where(&)]:min-w-0 [:where(&)]:[grid-template-columns:repeat(auto-fit,minmax(min(100%,max(var(--grid-column-min),calc((100%_-_(var(--grid-columns)_-_1)_*_var(--grid-gap))_/_var(--grid-columns)))),1fr))] ${gaps[gap]}  ${aligns[align]}  ${className}`,
    style: {
      "--grid-columns": columns,
      "--grid-gap": gap === 0 ? "0px" : `var(--space-${gap})`,
      "--grid-column-min":
        typeof minColumnWidth === "number" ? `${minColumnWidth}px` : minColumnWidth,
      ...style,
    } as CSSProperties,
  });
}

/** A named group of actions keeps keyboard behavior native to its controls. */
export function Toolbar<T extends LayoutElement = "div">({
  className = "",
  ...props
}: StackProps<T>) {
  return (
    <Row<T>
      {...({
        role: "group",
        wrap: true,
        ...props,
        className: `ui-toolbar ${className}`,
      } as StackProps<T>)}
    />
  );
}

/** Keeps closely related actions together at the compact spacing token. */
export function ButtonGroup<T extends LayoutElement = "div">({
  className = "",
  ...props
}: StackProps<T>) {
  return (
    <Row<T>
      {...({
        role: "group",
        gap: 1,
        ...props,
        className: `button-group ${className}`,
      } as StackProps<T>)}
    />
  );
}
