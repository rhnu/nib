import { t, useTranslation } from "@/shared/i18n";
import { Popover } from "@base-ui/react/popover";
import { X } from "lucide-react";
import { Field, Toggle } from "@/shared/ui";
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
        className="image-input-positioner"
      >
        <Popover.Popup className="image-input-popup" initialFocus={false}>
          <header>
            <Popover.Title>{t("inputs.advancedImageToImage")}</Popover.Title>
            <Popover.Close
              className="icon-button"
              aria-label={t("inputs.closeAdvancedImageToImage")}
            >
              <X size={14} />
            </Popover.Close>
          </header>
          <div className="image-operation-fields">
            <fieldset
              className="image-operation-toggle"
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
            </fieldset>
            <div data-setting-field="extraNoiseSeed">
              <Field label={t("inputs.extraNoiseSeed")}>
                <input
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
            <fieldset
              className="image-operation-toggle"
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
            </fieldset>
          </div>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}
