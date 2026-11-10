import { IconButton, Grid, Row, Input, Field, Toggle } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { Popover } from "@base-ui/react/popover";
import { X } from "lucide-react";

import { optionalImageSeed } from "../image-operation";
import type { ImageToImageSettingsProps } from "./image-to-image-settings";

/** Advanced values remain in the draft when the popover closes. */
export function ImageToImageAdvancedSettings({
  operation,
  feedback,
  updateOperation,
}: Pick<ImageToImageSettingsProps, "operation" | "feedback" | "updateOperation">) {
  useTranslation();

  const { messages, controlProps } = feedback;
  return (
    <Popover.Portal>
      <Popover.Positioner
        side="right"
        align="start"
        sideOffset={8}
        className="image-input-positioner z-60 max-w-[calc(100vw_-_24px)]"
      >
        <Popover.Popup
          className="image-input-popup [&_>_header]:flex [&_>_header]:items-center [&_>_header]:justify-between [&_>_header]:gap-space-3 [&_>_header]:mb-space-4 [&_>_header]:text-label [&_>_header]:font-semibold [&_>_header_h2]:[font-size:inherit] [&_>_header_h2]:m-0 [&_>_header_h2]:wrap-anywhere [&_>_p]:text-caption [&_>_p]:text-muted w-[290px] max-w-[calc(100vw_-_24px)] max-h-[min(620px,_var(--available-height))] overflow-auto p-space-4 [border:1px_solid_var(--line)] rounded-control bg-panel shadow-overlay"
          initialFocus={false}
        >
          <header>
            <Popover.Title>{t("inputs.advancedImageToImage")}</Popover.Title>
            <Popover.Close
              render={<IconButton label={t("inputs.closeAdvancedImageToImage")} />}
              className="icon-button"
              aria-label={t("inputs.closeAdvancedImageToImage")}
            >
              <X size={14} />
            </Popover.Close>
          </header>
          <Grid
            align="stretch"
            gap={0}
            columns={1}
            minColumnWidth="0px"
            className="image-operation-fields [&_input]:w-full [&_input]:h-control [&_input]:min-w-0 [&_input]:text-label [&_input]:rounded-control grid gap-[10px] min-w-0"
          >
            <Row
              as="fieldset"
              gap={0}
              className="image-operation-toggle [&_.image-operation-diagnostic]:basis-full flex items-center justify-between gap-space-3 flex-wrap text-label min-w-0 p-0 m-0 [border:0]"
              data-setting-field="colorCorrect"
              aria-label={t("inputs.colorCorrect")}
              {...controlProps("colorCorrect")}
            >
              <span>{t("inputs.colorCorrect")}</span>
              <Toggle
                label={t("inputs.colorCorrect")}
                checked={operation.colorCorrect}
                onChange={(colorCorrect) =>
                  updateOperation((current) =>
                    current.kind === "imageToImage" ? { ...current, colorCorrect } : current,
                  )
                }
              />
              {messages("colorCorrect")}
            </Row>
            <div data-setting-field="extraNoiseSeed">
              <Field label={t("inputs.extraNoiseSeed")}>
                <Input
                  {...controlProps("extraNoiseSeed")}
                  type="number"
                  step={1}
                  placeholder={t("inputs.inheritSeedHint")}
                  value={operation.extraNoiseSeed ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value;
                    updateOperation((current) =>
                      current.kind === "imageToImage"
                        ? { ...current, extraNoiseSeed: optionalImageSeed(raw) }
                        : current,
                    );
                  }}
                />
              </Field>
              {messages("extraNoiseSeed")}
            </div>
            <Row
              as="fieldset"
              gap={0}
              className="image-operation-toggle [&_.image-operation-diagnostic]:basis-full flex items-center justify-between gap-space-3 flex-wrap text-label min-w-0 p-0 m-0 [border:0]"
              data-setting-field="addOriginalImage"
              aria-label={t("inputs.addOriginalImage")}
              {...controlProps("addOriginalImage")}
            >
              <span>{t("inputs.addOriginalImage")}</span>
              <Toggle
                label={t("inputs.addOriginalImage")}
                checked={operation.addOriginalImage}
                onChange={(addOriginalImage) =>
                  updateOperation((current) =>
                    current.kind === "imageToImage" ? { ...current, addOriginalImage } : current,
                  )
                }
              />
              {messages("addOriginalImage")}
            </Row>
          </Grid>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}
