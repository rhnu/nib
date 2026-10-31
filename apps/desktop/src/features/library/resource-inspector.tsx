import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, X } from "lucide-react";
import type { ResourceSummary, ResourceFolder } from "@/bindings/workbench";
import { t, useTranslation, formatDate } from "@/shared/i18n";
import { Button, IconButton } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
import { PromptTextEditor } from "@/features/prompt/prompt-text-editor";
import { settingValue } from "@/features/prompt/settings";
import { ResourceCover } from "./resource-cover";
import { resourceQuery } from "./resource-queries";
import { folderPath } from "./resource-metadata";

export function ResourceInspector({
  item,
  count,
  folders,
  onClose,
  onEdit,
}: {
  item: ResourceSummary | undefined;
  count: number;
  folders: ResourceFolder[];
  onClose: () => void;
  onEdit: (id: string) => void;
}) {
  useTranslation();
  const client = useQueryClient();
  const query = useQuery({
    ...resourceQuery(client, item?.id ?? ""),
    enabled: !!item && count === 1,
  });
  const resource = query.data;
  return (
    <aside className="resource-inspector">
      <header>
        <strong>{t("library.inspector")}</strong>
        <IconButton label={t("library.closeInspector")} onClick={onClose}>
          <X size={15} />
        </IconButton>
      </header>
      {count > 1 ? (
        <p className="empty-note">{t("library.selectedCount", { count })}</p>
      ) : !item ? (
        <p className="empty-note">{t("library.inspectHint")}</p>
      ) : (
        <>
          <ResourceCover assetId={item.coverAssetId} name={item.name} kind={item.kind} />
          <h3>{item.name}</h3>
          <Button onClick={() => onEdit(item.id)}>
            <Pencil size={14} />
            {t("library.edit")}
          </Button>
          {query.error && (
            <p className="inline-warning" role="alert">
              {errorMessage(query.error)}
              <Button onClick={() => void query.refetch()}>{t("library.retryQuery")}</Button>
            </p>
          )}
          <p className="resource-description">{item.description}</p>
          <dl>
            <dt>{t("library.folder")}</dt>
            <dd>{folderPath(item.folderId, folders)}</dd>
            {item.aliases.length > 0 && (
              <>
                <dt>{t("library.aliases")}</dt>
                <dd>{item.aliases.join(", ")}</dd>
              </>
            )}
            <dt>{t("library.tags")}</dt>
            <dd>
              {item.tags.length
                ? item.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))
                : "—"}
            </dd>
            <dt>{t("library.models")}</dt>
            <dd>
              {item.models.length
                ? item.models.map((model) => settingValue("model", model)).join(", ")
                : t("library.unrestricted")}
            </dd>
            <dt>{t("library.updated")}</dt>
            <dd>{formatDate(item.updatedAt)}</dd>
          </dl>
          {resource?.content.kind === "chunk" && (
            <PromptTextEditor
              label={t("library.promptContent")}
              value={resource.content.text}
              readOnly
            />
          )}
          {resource?.content.kind === "preset" && (
            <div className="resource-preset-summary">
              <h4>{t("library.preset")}</h4>
              <p>
                {t("library.presetSummary", {
                  positive: resource.content.composition.positive.length,
                  negative: resource.content.composition.negative.length,
                  characters: resource.content.characters.length,
                })}
              </p>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
