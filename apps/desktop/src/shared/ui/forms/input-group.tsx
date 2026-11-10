import type { ComponentProps } from "react";
import { Row } from "../layout/stack";

/** Inputs stretch while adjoining buttons keep the common control height. */
export function InputRow({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <Row
      className={`input-row [:where(&>:first-child)]:min-w-0 [:where(&>:first-child)]:flex-1 [:where(&>button)]:h-(--control-height) [:where(&>button)]:shrink-0 ${className}`}
      {...props}
    />
  );
}

/** A visual input group provides a named group for composite input actions. */
export function InputGroup({ className = "", ...props }: ComponentProps<"fieldset">) {
  return (
    <Row
      as="fieldset"
      className={`input-group [:where(&)]:m-0 [:where(&)]:border-0 [:where(&)]:p-0 [:where(&>:first-child)]:min-w-0 [:where(&>:first-child)]:flex-1 [:where(&>button)]:h-(--control-height) [:where(&>button)]:shrink-0 ${className}`}
      {...props}
    />
  );
}
