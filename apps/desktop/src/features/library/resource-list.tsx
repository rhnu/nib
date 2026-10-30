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
  return (
    <div className="resource-list" aria-busy={loading}>
      {loading ? (
        <p className="empty-note">正在查询…</p>
      ) : queryError ? (
        <p className="empty-note">资源查询未完成，请重试。</p>
      ) : items.length === 0 ? (
        <p className="empty-note">{filtered ? "没有匹配的资源" : "尚无资源"}</p>
      ) : (
        items.map((item) => (
          <div className={`resource-row ${selectedId === item.id ? "selected" : ""}`} key={item.id}>
            <Button className="resource-select" onClick={() => onSelect(item.id)}>
              {item.kind === "chunk" ? <Link2 size={17} /> : <FileText size={17} />}
              <span>
                {item.name}
                <small>{item.kind === "chunk" ? "Chunk" : "Preset"}</small>
              </span>
            </Button>
            <Button
              className="icon-button"
              aria-label={`添加 ${item.name}`}
              title={
                item.kind === "preset"
                  ? "添加到应用的 Preset"
                  : `添加到${target === "negative" ? "负面" : "基础"}提示`
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
