import { uiStyles } from "./styles";
import { useFieldAssociation } from "../forms/field-context";
import { useRef, useState, type AriaAttributes } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { X } from "lucide-react";

type TagInputProps = Pick<
  AriaAttributes,
  "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid"
> & {
  id: string;
  value: string[];
  onValueChange: (value: string[]) => void;
  suggestions?: readonly string[];
  removeLabel: (value: string) => string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

/** Controlled tags share Base UI's chip navigation and searchable suggestion popup. */
export function TagInput({
  id,
  value,
  onValueChange,
  suggestions = [],
  removeLabel,
  disabled = false,
  placeholder,
  className = "",
  ...aria
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const field = useFieldAssociation();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const selected = new Set(value);
  const items = [...new Set(suggestions)].filter((item) => !selected.has(item));

  // Native fieldsets also disable the input, while portaled options and div chips live
  // outside that native protection. Check the input at each mutation boundary.
  function isDisabled() {
    return disabled || Boolean(inputRef.current?.matches(":disabled"));
  }

  function containsFocus(target: EventTarget | null) {
    return (
      target instanceof Node &&
      (rootRef.current?.contains(target) || popupRef.current?.contains(target))
    );
  }

  function commitDraft(text: string) {
    if (isDisabled() || composing.current) return;
    const next = text.trim();
    if (next && !selected.has(next)) onValueChange([...value, next]);
    setDraft("");
  }

  return (
    <Combobox.Root<string, true>
      multiple
      value={value}
      items={items}
      inputValue={draft}
      disabled={disabled}
      autoComplete="off"
      onOpenChange={(open, details) => {
        if (open && (isDisabled() || !items.length)) details.cancel();
      }}
      onInputValueChange={(next, details) => {
        // Multiple Combobox normally discards its search on close. Here it is an
        // uncommitted tag, so only typing or selecting a suggestion may replace it.
        if (details.reason === "input-change" || details.isItemPress) setDraft(next);
        else details.cancel();
      }}
      onValueChange={(next, details) => {
        if (isDisabled() || composing.current) {
          details.cancel();
          return;
        }
        onValueChange(next);
        if (details.reason === "item-press") setDraft("");
      }}
    >
      <div
        ref={rootRef}
        className={`tag-input-root ${uiStyles["tag-input-root"]}  ${className}`}
        data-context-actions=""
        onBlur={(event) => {
          if (!containsFocus(event.relatedTarget)) commitDraft(inputRef.current?.value ?? draft);
        }}
      >
        <Combobox.Chips
          className={`tag-input ${uiStyles["tag-input"]}`}
          aria-labelledby={aria["aria-labelledby"]}
          aria-label={aria["aria-label"]}
          data-disabled={disabled || undefined}
          data-invalid={
            aria["aria-invalid"] === true || aria["aria-invalid"] === "true" || undefined
          }
          onMouseDown={(event) => {
            if (isDisabled()) event.preventBaseUIHandler();
          }}
        >
          {value.map((tag, index) => (
            <Combobox.Chip
              key={`${tag}-${index}`}
              className={`tag-input-chip ${uiStyles["tag-input-chip"]}`}
              onKeyDown={(event) => {
                if (isDisabled()) event.preventBaseUIHandler();
              }}
            >
              <span
                className={`tag-input-chip-label ${uiStyles["tag-input-chip-label"]}`}
                title={tag}
              >
                {tag}
              </span>
              <Combobox.ChipRemove
                className={`tag-input-remove ${uiStyles["tag-input-remove"]}`}
                aria-label={removeLabel(tag)}
                title={removeLabel(tag)}
              >
                <X size={12} aria-hidden />
              </Combobox.ChipRemove>
            </Combobox.Chip>
          ))}
          <Combobox.Input
            {...aria}
            id={id ?? field?.controlId}
            aria-describedby={
              [aria["aria-describedby"], field?.describedBy].filter(Boolean).join(" ") || undefined
            }
            ref={inputRef}
            className={`tag-input-draft ${uiStyles["tag-input-draft"]}`}
            placeholder={placeholder}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              const text = event.currentTarget.value;
              // Some IMEs finish after blur. Wait for Base UI to publish the final
              // composed value before committing a field that has already lost focus.
              if (!containsFocus(document.activeElement)) {
                queueMicrotask(() => {
                  if (inputRef.current && !containsFocus(document.activeElement)) commitDraft(text);
                });
              }
            }}
            onKeyDown={(event) => {
              if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
                event.preventBaseUIHandler();
                return;
              }
              if (
                event.key === "Escape" &&
                event.currentTarget.getAttribute("aria-expanded") !== "true"
              ) {
                // Base UI clears all selected values on Escape while closed.
                event.preventBaseUIHandler();
                return;
              }
              if (
                event.key !== "Enter" ||
                event.ctrlKey ||
                event.altKey ||
                event.metaKey ||
                event.shiftKey ||
                event.currentTarget.getAttribute("aria-activedescendant")
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              event.preventBaseUIHandler();
              commitDraft(event.currentTarget.value);
            }}
          />
        </Combobox.Chips>
        <Combobox.Portal>
          <Combobox.Positioner
            anchor={rootRef}
            align="start"
            sideOffset={4}
            className={`select-positioner ${uiStyles["select-positioner"]} tag-input-positioner [&[data-empty]]:hidden`}
          >
            <Combobox.Popup
              ref={popupRef}
              className={`select-popup ${uiStyles["select-popup"]}`}
              data-context-actions=""
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <Combobox.List className={`select-list ${uiStyles["select-list"]}`}>
                {(item: string) => (
                  <Combobox.Item
                    key={item}
                    value={item}
                    className={`select-option ${uiStyles["select-option"]}`}
                  >
                    {item}
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </div>
    </Combobox.Root>
  );
}
