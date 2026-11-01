import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import type { ResourceKind } from "@/bindings/workbench";
import { settingValue } from "@/features/prompt/settings";
import { t, useTranslation } from "@/shared/i18n";
import { ActionsMenu, Button, Field, Select, type ActionMenuItem } from "@/shared/ui";

/** Search an existing shared tag without creating or renaming catalogue data. */
export function ResourceTagSelect({
  value,
  tags,
  onChange,
}: {
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
      <Combobox.Trigger className="select-trigger" aria-label={t("library.tags")}>
        <span className="select-value">
          <Combobox.Value />
        </span>
        <ChevronDown className="select-icon" size={14} aria-hidden />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner className="select-positioner" sideOffset={4} align="start">
          <Combobox.Popup className="select-popup resource-tag-popup">
            <Combobox.Input
              aria-label={t("library.searchTags")}
              placeholder={t("library.searchTags")}
            />
            <Combobox.Empty className="empty-note">{t("library.noMatchingTags")}</Combobox.Empty>
            <Combobox.List className="select-list">
              {(tag: string) => (
                <Combobox.Item key={tag} value={tag} className="select-option">
                  <span>{tag || t("library.allTags")}</span>
                  <Combobox.ItemIndicator className="select-check">
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
  const count = [kind, model, tag].filter(Boolean).length;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="resource-filter-trigger" data-active={count > 0 || undefined}>
        <SlidersHorizontal size={15} aria-hidden />
        {t("library.filters")}
        {count > 0 && <span>{count}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="resource-filter-positioner" align="end" sideOffset={5}>
          <Popover.Popup className="resource-filter-popup">
            <header className="ui-heading">
              <Popover.Title>{t("library.filters")}</Popover.Title>
              <Popover.Close className="icon-button" aria-label={t("common.close")}>
                <X size={15} />
              </Popover.Close>
            </header>
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
            <div className="resource-tag-filter">
              <Field label={t("library.tags")}>
                <ResourceTagSelect value={tag} tags={tags} onChange={(tag) => onChange({ tag })} />
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
            </div>
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
