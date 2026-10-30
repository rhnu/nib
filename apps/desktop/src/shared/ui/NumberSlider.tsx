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
  const [typing, setTyping] = useState<{ source: number; text: string } | null>(null);
  return (
    <div className="number-slider">
      <input
        type="range"
        aria-label={`${label}滑块`}
        min={sliderRange.min}
        max={sliderRange.max}
        step="0.01"
        value={Math.max(sliderRange.min, Math.min(sliderRange.max, value))}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
      <input
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
    </div>
  );
}
