import { Col, Grid, Row } from "@/shared/ui";

import type { ComponentProps } from "react";

/** A compact image and its parameters reflow within their own panel. */
export function MediaInputLayout({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <Grid
      align="start"
      columns={2}
      gap={3}
      className={`grid-cols-[144px_minmax(0,1fr)] @max-[280px]:grid-cols-1 ${className}`}
      {...props}
    />
  );
}

/** The material preview keeps image dimensions and its action overlay consistent. */
export function MediaInputPreview({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <Grid
      columns={1}
      gap={0}
      className={`media-input-preview relative place-items-center w-36 min-h-36 shrink-0 rounded-control bg-background text-muted [&_img]:block [&_img]:size-36 [&_img]:object-contain [&_img]:rounded-control [&:hover_.media-input-tools]:bg-panel [&:focus-within_.media-input-tools]:bg-panel ${className}`}
      {...props}
    />
  );
}

/** Image operations share one visible row of named icon actions. */
export function MediaInputTools({ className = "", ...props }: ComponentProps<"fieldset">) {
  return (
    <Row
      as="fieldset"
      gap={0}
      className={`media-input-tools absolute bottom-1 left-1/2 -translate-x-1/2 flex-nowrap gap-0.5 m-0 p-[3px] border border-line rounded-control bg-panel/90 shadow-[0_2px_12px_#0003] [&_.icon-button]:size-control [&_.icon-button]:min-h-control [&_.icon-button]:p-0 ${className}`}
      {...props}
    />
  );
}

/** Compact fields use the same label and control slots as the main form. */
export function MediaInputSettings({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <Col
      gap={2}
      className={`[&_.ui-grid]:grid-cols-1 [&_.ui-field]:gap-0.5 [&_.form-label]:min-h-6 [&_.form-label]:leading-[18px] [&_.number-slider_input[type=number]]:h-control-compact ${className}`}
      {...props}
    />
  );
}
