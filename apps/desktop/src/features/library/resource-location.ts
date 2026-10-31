import type { ResourceFolder } from "@/bindings/workbench";

/** Resolve the current folder's ancestors in root-to-leaf order, including legacy deep paths. */
export function folderAncestry(id: string | null, folders: ResourceFolder[]): ResourceFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: ResourceFolder[] = [];
  const visited = new Set<string>();
  let folder = id ? byId.get(id) : undefined;
  while (folder && !visited.has(folder.id)) {
    visited.add(folder.id);
    path.unshift(folder);
    folder = folder.parentId ? byId.get(folder.parentId) : undefined;
  }
  return path;
}

/** Folder browsing is direct; a nonblank search expands only the current subtree. */
export function resourceLocationQuery(folderId: string | null, text: string) {
  const searching = Boolean(text.trim());
  return { folderId, includeSubfolders: searching, rootOnly: !folderId && !searching };
}

/** Exclude selected trees from a destination browser, including all their descendants. */
export function destinationFolders(folders: ResourceFolder[], excluded: string[]) {
  return folders.filter(
    (folder) =>
      !folderAncestry(folder.id, folders).some((ancestor) => excluded.includes(ancestor.id)),
  );
}
