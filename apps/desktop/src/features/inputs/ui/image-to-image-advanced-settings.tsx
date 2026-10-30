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
            <Popover.Title>图生图高级设置</Popover.Title>
            <Popover.Close className="icon-button" aria-label="关闭图生图高级设置">
              <X size={14} />
            </Popover.Close>
          </header>
          <div className="image-operation-fields">
            <fieldset
              className="image-operation-toggle"
              data-setting-field="colorCorrect"
              aria-label="Color Correct"
              {...controlProps("colorCorrect")}
            >
              <span>Color Correct</span>
              <Toggle
                label="Color Correct"
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
              <Field label="额外噪声种子">
                <input
                  {...controlProps("extraNoiseSeed")}
                  type="number"
                  step={1}
                  placeholder="留空继承生成种子"
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
              aria-label="Add Original Image"
              {...controlProps("addOriginalImage")}
            >
              <span>Add Original Image</span>
              <Toggle
                label="Add Original Image"
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
