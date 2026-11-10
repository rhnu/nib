import {
  controlStyles,
  Button,
  inputStyles,
  IconButton,
  ActionsMenu,
  Field,
  Select,
  type ActionMenuItem,
  Row,
} from "@/shared/ui";

import { useId, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import type { ResourceKind } from "@/bindings/workbench";
import { settingValue } from "@/features/prompt/settings";
import { t, useTranslation } from "@/shared/i18n";

/** Search an existing shared tag without creating or renaming catalogue data. */
export function ResourceTagSelect({
  id,
  value,
  tags,
  onChange,
}: {
  id?: string;
  value: string;
  tags: string[];
  onChange: (value: string) => void;
}) {
  useTranslation();
  return (
    <Combobox.Root
      items={["", ...new Set([...tags, ...(value ? [value] : [])])]}
      value={value}
      itemToStringLabel={(tag) => tag || t("library.allTags")}
      onValueChange={(tag) => onChange(tag ?? "")}
    >
      <Combobox.Trigger
        render={<Button />}
        id={id}
        className={`select-trigger ${controlStyles["select-trigger"]}`}
        aria-label={t("library.tags")}
      >
        <span className={`select-value ${controlStyles["select-value"]}`}>
          <Combobox.Value />
        </span>
        <ChevronDown
          className={`select-icon ${controlStyles["select-icon"]}`}
          size={14}
          aria-hidden
        />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          className={`select-positioner ${controlStyles["select-positioner"]}`}
          sideOffset={4}
          align="start"
        >
          <Combobox.Popup
            className={`select-popup resource-tag-popup [&_>_input]:shrink-0 [&_>_input]:w-[calc(100%_-_12px)] [&_>_input]:m-space-2 [&_.empty-note]:p-space-3 ${controlStyles["select-popup"]}`}
          >
            <Combobox.Input
              className={`${inputStyles} h-control`}
              aria-label={t("library.searchTags")}
              placeholder={t("library.searchTags")}
            />
            <Combobox.Empty className="empty-note text-muted text-label leading-[1.75] m-[3px_0]">
              {t("library.noMatchingTags")}
            </Combobox.Empty>
            <Combobox.List className={`select-list ${controlStyles["select-list"]}`}>
              {(tag: string) => (
                <Combobox.Item
                  key={tag}
                  value={tag}
                  className={`select-option ${controlStyles["select-option"]}`}
                >
                  <span>{tag || t("library.allTags")}</span>
                  <Combobox.ItemIndicator
                    className={`select-check ${controlStyles["select-check"]}`}
                  >
                    <Check size={14} aria-hidden />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/** Keep catalogue filters together while their values remain owned by the library session. */
export function ResourceFilters({
  kind,
  model,
  tag,
  models,
  tags,
  onChange,
  tagActions,
}: {
  kind: ResourceKind | "";
  model: string;
  tag: string;
  models: string[];
  tags: string[];
  onChange: (patch: Partial<{ kind: ResourceKind | ""; model: string; tag: string }>) => void;
  tagActions: ActionMenuItem[];
}) {
  useTranslation();
  const [open, setOpen] = useState(false);
  const tagId = useId();
  const count = [kind, model, tag].filter(Boolean).length;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={<Button />}
        className="resource-filter-trigger [&[data-active]]:border-accent [&[data-active]]:text-accent [&_>_span]:tabular-nums shrink-0"
        data-active={count > 0 || undefined}
      >
        <SlidersHorizontal size={15} aria-hidden />
        {t("library.filters")}
        {count > 0 && <span>{count}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="resource-filter-positioner z-[60] max-w-[var(--available-width)]"
          align="end"
          sideOffset={5}
        >
          <Popover.Popup className="resource-filter-popup [&_.ui-heading]:m-0 [&_footer]:justify-end [&_footer]:flex w-[320px] max-w-[var(--available-width)] max-h-[var(--available-height)] overflow-y-auto flex flex-col gap-space-4 p-space-4 border border-line rounded-overlay bg-raised shadow-[var(--shadow)]">
            <Row
              align="center"
              justify="between"
              gap={3}
              as="header"
              className="ui-heading flex items-center justify-between gap-space-3 min-w-0 min-h-control [&_>_:is(h2,_h3)]:m-0 [&_>_:is(h2,_h3)]:min-w-0 [&_>_:is(h2,_h3)]:text-section [&_>_:is(h2,_h3)]:font-semibold"
            >
              <Popover.Title>{t("library.filters")}</Popover.Title>
              <Popover.Close
                render={<IconButton label={t("common.close")} />}
                className="icon-button"
                aria-label={t("common.close")}
              >
                <X size={15} />
              </Popover.Close>
            </Row>
            <Field label={t("library.resourceType")}>
              <Select
                value={kind}
                onValueChange={(kind) => onChange({ kind: kind as ResourceKind | "" })}
                options={[
                  { value: "", label: t("library.allTypes") },
                  { value: "chunk", label: t("library.chunk") },
                  { value: "preset", label: t("library.preset") },
                ]}
              />
            </Field>
            <Field label={t("library.models")}>
              <Select
                value={model}
                onValueChange={(model) => onChange({ model })}
                options={[
                  { value: "", label: t("library.allModels") },
                  ...[...new Set([...models, ...(model ? [model] : [])])].map((model) => ({
                    value: model,
                    label: settingValue("model", model),
                  })),
                ]}
              />
            </Field>
            <Row
              gap={0}
              className="resource-tag-filter [&_>_.form-field]:flex-1 [&_>_.form-field]:min-w-0 flex items-end gap-space-2"
            >
              <Field label={t("library.tags")} htmlFor={tagId}>
                <ResourceTagSelect
                  id={tagId}
                  value={tag}
                  tags={tags}
                  onChange={(tag) => onChange({ tag })}
                />
              </Field>
              <ActionsMenu
                label={t("library.manageTag")}
                items={tagActions.map((item) =>
                  "action" in item
                    ? {
                        ...item,
                        action: () => {
                          setOpen(false);
                          item.action();
                        },
                      }
                    : item,
                )}
              />
            </Row>
            <footer>
              <Button disabled={!count} onClick={() => onChange({ kind: "", model: "", tag: "" })}>
                {t("library.clearFilters")}
              </Button>
            </footer>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
