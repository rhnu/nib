import { Input } from "./input";
import { Grid } from "../layout/stack";
import { t, useTranslation } from "@/shared/i18n";
import { useState } from "react";

/** A common slider range complements numeric entry without rewriting values outside that range. */
export function NumberSlider({
  id,
  label,
  value,
  onChange,
  range,
  sliderRange = { min: 0, max: 1 },
  invalid,
  describedBy,
}: {
  id?: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  range?: { min: number; max: number } | null;
  sliderRange?: { min: number; max: number };
  invalid?: boolean;
  describedBy?: string;
}) {
  useTranslation();

  const [typing, setTyping] = useState<{ source: number; text: string } | null>(null);
  return (
    <Grid
      columns={1}
      gap={2}
      align="center"
      className="number-slider w-full grid-cols-[minmax(0,1fr)_66px]"
    >
      <input
        className="h-5 min-w-0 w-full border-0 bg-transparent p-0 accent-(--accent) focus-visible:outline-2 focus-visible:outline-(--accent) focus-visible:outline-offset-2"
        type="range"
        aria-label={t("common.sliderLabel", { value0: label })}
        min={sliderRange.min}
        max={sliderRange.max}
        step="0.01"
        value={Math.max(sliderRange.min, Math.min(sliderRange.max, value))}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
      <Input
        id={id}
        aria-label={label}
        type="number"
        step="any"
        min={range?.min}
        max={range?.max}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={typing?.source === value ? typing.text : value}
        onChange={(event) => {
          const number = event.currentTarget.valueAsNumber;
          const complete = Number.isFinite(number);
          setTyping({ source: complete ? number : value, text: event.currentTarget.value });
          if (complete) onChange(number);
        }}
        onBlur={() => setTyping(null)}
        onWheel={(event) => event.currentTarget.blur()}
      />
    </Grid>
  );
}
