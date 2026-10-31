import type { MediaAsset } from "@/bindings/media";
import { invokeHost } from "@/shared/host/invoke";
import type {
  Resource,
  ResourceQuery,
  ResourcePage,
  ResourceFolder,
  ResourceSelection,
  ResourceBatchAction,
  ResourceImpact,
  ResourceSummary,
} from "@/bindings/workbench";

/** Every caller searches the persisted catalogue; omitted filters have explicit defaults. */
export function resourceSearchQuery(query: Partial<ResourceQuery> = {}): ResourceQuery {
  return {
    sort: "name",
    descending: false,
    text: "",
    kind: null,
    tags: [],
    models: [],
    folderId: null,
    includeSubfolders: true,
    rootOnly: false,
    offset: 0,
    limit: 60,
    ...query,
  };
}

export const libraryApi = {
  search: (query: Partial<ResourceQuery>) =>
    invokeHost<ResourcePage>("search_resources", { query: resourceSearchQuery(query) }),
  importCover: (resourceId: string, bytes: number[]) =>
    invokeHost<MediaAsset>("import_resource_cover", { resourceId, bytes }),
  discardCover: (resourceId: string, assetId: string) =>
    invokeHost<void>("discard_resource_cover", { resourceId, assetId }),
  folders: () => invokeHost<ResourceFolder[]>("list_resource_folders"),
  renameTag: (oldName: string, newName: string) =>
    invokeHost<ResourceSummary[]>("rename_resource_tag", { oldName, newName }),
  deleteTag: (name: string) => invokeHost<ResourceSummary[]>("delete_resource_tag", { name }),
  tags: () => invokeHost<string[]>("list_resource_tags"),
  saveFolder: (folder: ResourceFolder) =>
    invokeHost<ResourceFolder>("save_resource_folder", { folder }),
  impact: (selection: ResourceSelection) =>
    invokeHost<ResourceImpact>("resource_selection_impact", { selection }),
  batch: (selection: ResourceSelection, action: ResourceBatchAction) =>
    invokeHost<ResourceImpact>("batch_resources", { selection, action }),
  resource: (id: string) => invokeHost<Resource>("get_resource", { id }),
  definitions: (ids: string[]) => invokeHost<Resource[]>("get_resource_definitions", { ids }),
  saveResource: (resource: Resource) => invokeHost<Resource>("save_resource", { resource }),
};
