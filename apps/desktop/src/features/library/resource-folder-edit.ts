import type {
  ResourceFolder,
  ResourceFolderChange,
  ResourceFolderEdit,
} from "@/bindings/workbench";

/** Send only intentional field changes, so stale display data cannot restore an old parent. */
export function resourceFolderEdit(
  original: ResourceFolder | null,
  edited: Pick<ResourceFolder, "id" | "name" | "parentId">,
): ResourceFolderEdit {
  const name = edited.name.trim();
  if (!original) return { kind: "create", id: edited.id, name, parentId: edited.parentId };
  const changes: ResourceFolderChange[] = [];
  if (name !== original.name) changes.push({ kind: "name", name });
  if (edited.parentId !== original.parentId)
    changes.push({ kind: "parent", parentId: edited.parentId });
  return { kind: "update", id: original.id, changes };
}
