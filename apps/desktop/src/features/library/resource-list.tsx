import { t, useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui";
import { FileText, Link2, Plus } from "lucide-react";
import type { ResourceSummary } from "@/bindings/workbench";

export function ResourceList({
  loading,
  queryError,
  items,
  filtered,
  selectedId,
  onSelect,
  onInsert,
  target,
}: {
  loading: boolean;
  queryError: string;
  items: ResourceSummary[];
  filtered: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
  onInsert: (resource: ResourceSummary) => void;
  target: "positive" | "negative" | "preset";
}) {
  useTranslation();

  return (
    <div className="resource-list" aria-busy={loading}>
      {loading ? (
        <p className="empty-note">{t("library.querying")}</p>
      ) : queryError ? (
        <p className="empty-note">{t("library.queryIncomplete")}</p>
      ) : items.length === 0 ? (
        <p className="empty-note">{filtered ? t("library.noMatches") : t("library.noResources")}</p>
      ) : (
        items.map((item) => (
          <div className={`resource-row ${selectedId === item.id ? "selected" : ""}`} key={item.id}>
            <Button className="resource-select" onClick={() => onSelect(item.id)}>
              {item.kind === "chunk" ? <Link2 size={17} /> : <FileText size={17} />}
              <span>
                {item.name}
                <small>{item.kind === "chunk" ? t("library.chunk") : t("library.preset")}</small>
              </span>
            </Button>
            <Button
              className="icon-button"
              aria-label={t("library.addNamedResource", { value0: item.name })}
              title={
                item.kind === "preset"
                  ? t("library.addAppliedPreset")
                  : t("library.addToPrompt", {
                      value0: target === "negative" ? t("library.negative") : t("library.base"),
                    })
              }
              onClick={() => onInsert(item)}
            >
              <Plus size={16} />
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
