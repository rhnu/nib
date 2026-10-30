import { invokeHost } from "@/shared/host/invoke";
import type { Resource, ResourceQuery, ResourceSummary } from "@/bindings/workbench";
export const libraryApi = {
  search: (query: ResourceQuery) => invokeHost<ResourceSummary[]>("search_resources", { query }),
  resource: (id: string) => invokeHost<Resource>("get_resource", { id }),
  definitions: (ids: string[]) => invokeHost<Resource[]>("get_resource_definitions", { ids }),
  saveResource: (resource: Resource) => invokeHost<Resource>("save_resource", { resource }),
  deleteResource: (id: string, revision: number) =>
    invokeHost<void>("delete_resource", { id, revision }),
};
