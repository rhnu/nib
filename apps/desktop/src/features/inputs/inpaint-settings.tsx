import {
  IconButton,
  overlayStyles,
  Row,
  ButtonGroup,
  Grid,
  Input,
  Button,
  Field,
  NumberSlider,
  Select,
  HelpMarker,
  Modal,
  Toggle,
} from "@/shared/ui";

import { t, useTranslation, errorMessage } from "@/shared/i18n";
import { useId, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { X } from "lucide-react";
import type { ParameterDiagnostic } from "@/bindings/generation";
import type {
  CreationOperation,
  ImageOperationOptions,
  ModelCapabilities,
} from "@/bindings/workbench";

import { optionalImageSeed } from "./image-operation";

type InpaintOperation = Extract<CreationOperation, { kind: "inpainting" }>;

/** Pure infilling and explicit source conditioning are different SDK inputs. */
export function InpaintSettings({
  operation,
  capabilities,
  defaults,
  optionsError,
  retryOptions,
  diagnostics,
  errorFields,
  update,
}: {
  operation: InpaintOperation;
  capabilities: ModelCapabilities | null;
  defaults: ImageOperationOptions["inpaintConditioning"] | null;
  optionsError: string | null;
  retryOptions: () => void;
  diagnostics: ParameterDiagnostic[];
  errorFields: string[];
  update: (change: (current: InpaintOperation) => InpaintOperation) => void;
}) {
  useTranslation();

  const prefix = useId();
  const [confirmPure, setConfirmPure] = useState(false);

  const normalize = (field: string) => field.replaceAll("_", "").toLowerCase().split(".").at(-1);

  const diagnostic = (field: string) =>
    diagnostics.filter((item) => normalize(item.field) === field.toLowerCase());

  const rejected = (field: string) =>
    errorFields.some((item) => normalize(item) === field.toLowerCase());

  const props = (field: string) => ({
    "aria-invalid": rejected(field) || undefined,
    "aria-describedby":
      diagnostic(field).length || rejected(field) ? `${prefix}-${field}` : undefined,
  });

  const messages = (field: string) =>
    diagnostic(field).length || rejected(field) ? (
      <output
        className="image-operation-diagnostic grid text-danger text-caption leading-[1.6] mt-space-1"
        id={`${prefix}-${field}`}
      >
        {diagnostic(field).map((item, index) => (
          <span key={index}>{errorMessage(item.change)}</span>
        ))}
        {rejected(field) && <span>{t("inputs.fieldRejected")}</span>}
      </output>
    ) : null;

  const numeric = (field: "strength" | "noise", raw: string) => {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value)) return;
    update((current) =>
      current.img2img ? { ...current, img2img: { ...current.img2img, [field]: value } } : current,
    );
  };

  const conditioning = operation.img2img;
  return (
    <Grid
      align="stretch"
      gap={0}
      columns={1}
      minColumnWidth="0px"
      className="image-operation-fields [&_input]:w-full [&_input]:h-control [&_input]:min-w-0 [&_input]:text-label [&_input]:rounded-control grid gap-[10px] min-w-0"
    >
      {capabilities?.inpainting === false && (
        <p className="inline-warning text-danger text-label leading-[1.7]" role="alert">
          {t("inputs.inpaintingUnsupported")}
        </p>
      )}
      {conditioning && capabilities?.inpaintingImageToImage === false && (
        <p className="inline-warning text-danger text-label leading-[1.7]" role="alert">
          {t("inputs.regionalConditioningUnsupported")}
        </p>
      )}
      <div data-setting-field="img2img">
        <Row
          gap={0}
          className="setting-label flex items-center gap-space-1 min-h-[24px] text-muted text-caption [&_.icon-button]:w-[24px] [&_.icon-button]:min-h-[24px]"
        >
          <span>{t("inputs.regionalConditioning")}</span>
          <HelpMarker label={t("inputs.regionalConditioningHelpTitle")}>
            {t("inputs.regionalConditioningHelp")}
          </HelpMarker>
        </Row>
        <Select
          aria-label={t("inputs.regionalConditioning")}
          {...props("img2img")}
          value={conditioning ? "conditioned" : "pure"}
          onValueChange={(value) => {
            if (value === "pure") setConfirmPure(true);
            else if (defaults) update((current) => ({ ...current, img2img: { ...defaults } }));
          }}
          options={[
            { value: "pure", label: t("inputs.pureInpainting") },
            {
              value: "conditioned",
              label: t("inputs.regionalImageToImage"),
              disabled:
                capabilities?.inpaintingImageToImage === false || (!defaults && !conditioning),
            },
          ]}
        />
        {messages("img2img")}
      </div>
      {!defaults &&
        capabilities?.inpaintingImageToImage &&
        (optionsError ? (
          <div className="inline-warning text-danger text-label leading-[1.7]" role="alert">
            {optionsError}
            <Button variant="quiet" className="" onClick={retryOptions}>
              {t("inputs.retry")}
            </Button>
          </div>
        ) : (
          <output className="muted text-muted">{t("inputs.loadingConditioningOptions")}</output>
        ))}
      {conditioning && (
        <>
          <Grid align="stretch" columns={2} minColumnWidth="110px" gap={3}>
            {(["strength", "noise"] as const).map((field) => {
              const range =
                capabilities?.ranges[field === "strength" ? "inpaintStrength" : "img2imgNoise"];
              const label = field === "strength" ? t("inputs.strength") : t("inputs.noise");
              return (
                <div key={field} data-setting-field={field}>
                  <Field
                    label={label}
                    htmlFor={`${prefix}-${field}-input`}
                    feedback={messages(field)}
                  >
                    <NumberSlider
                      id={`${prefix}-${field}-input`}
                      label={label}
                      value={conditioning[field]}
                      range={range}
                      sliderRange={range}
                      invalid={rejected(field)}
                      describedBy={props(field)["aria-describedby"]}
                      onChange={(value) => numeric(field, String(value))}
                    />
                  </Field>
                </div>
              );
            })}
          </Grid>
        </>
      )}
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
              <Popover.Title>{t("inputs.advancedInpaint")}</Popover.Title>
              <Popover.Close
                render={<IconButton label={t("inputs.closeAdvancedInpaint")} />}
                className="icon-button"
                aria-label={t("inputs.closeAdvancedInpaint")}
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
              {conditioning && (
                <>
                  <Row
                    as="fieldset"
                    gap={0}
                    className="image-operation-toggle [&_.image-operation-diagnostic]:basis-full flex items-center justify-between gap-space-3 flex-wrap text-label min-w-0 p-0 m-0 [border:0]"
                    data-setting-field="colorCorrect"
                    aria-label={t("inputs.colorCorrect")}
                    {...props("colorCorrect")}
                  >
                    <span>{t("inputs.colorCorrect")}</span>
                    <Toggle
                      label={t("inputs.colorCorrect")}
                      checked={conditioning.color_correct}
                      onChange={(color_correct) =>
                        update((current) =>
                          current.img2img
                            ? { ...current, img2img: { ...current.img2img, color_correct } }
                            : current,
                        )
                      }
                    />
                    {messages("colorCorrect")}
                  </Row>
                  <div data-setting-field="extraNoiseSeed">
                    <Field label={t("inputs.extraNoiseSeed")}>
                      <Input
                        {...props("extraNoiseSeed")}
                        type="number"
                        step={1}
                        placeholder={t("inputs.inheritSeedHint")}
                        value={conditioning.extra_noise_seed ?? ""}
                        onChange={(event) => {
                          const extra_noise_seed = optionalImageSeed(event.target.value);
                          update((current) =>
                            current.img2img
                              ? { ...current, img2img: { ...current.img2img, extra_noise_seed } }
                              : current,
                          );
                        }}
                      />
                    </Field>
                    {messages("extraNoiseSeed")}
                  </div>
                </>
              )}
              <Row
                as="fieldset"
                gap={0}
                className="image-operation-toggle [&_.image-operation-diagnostic]:basis-full flex items-center justify-between gap-space-3 flex-wrap text-label min-w-0 p-0 m-0 [border:0]"
                data-setting-field="addOriginalImage"
                aria-label={t("inputs.keepOutsideMask")}
                {...props("addOriginalImage")}
              >
                <span>{t("inputs.keepOutsideMask")}</span>
                <Toggle
                  label={t("inputs.keepOutsideMask")}
                  checked={operation.addOriginalImage}
                  onChange={(addOriginalImage) =>
                    update((current) => ({ ...current, addOriginalImage }))
                  }
                />
                {messages("addOriginalImage")}
              </Row>
            </Grid>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
      <Modal
        open={confirmPure}
        onClose={() => setConfirmPure(false)}
        title={t("inputs.switchToPureTitle")}
      >
        <p className={`confirm-copy ${overlayStyles["confirm-copy"]}`}>
          {t("inputs.switchToPureWarning")}
        </p>
        <ButtonGroup
          gap={0}
          className="dialog-actions flex items-center justify-end flex-wrap gap-space-3 mt-space-4"
        >
          <Button onClick={() => setConfirmPure(false)}>{t("inputs.cancel")}</Button>
          <Button
            variant="primary"
            className=""
            onClick={() => {
              update((current) => ({ ...current, img2img: null }));
              setConfirmPure(false);
            }}
          >
            {t("inputs.usePureInpainting")}
          </Button>
        </ButtonGroup>
      </Modal>
    </Grid>
  );
}
