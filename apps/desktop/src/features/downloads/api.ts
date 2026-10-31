import type { DownloadStatus } from "@/bindings/downloads";
import { invokeHost } from "@/shared/host/invoke";
import { queryClient } from "@/shared/query/client";

export const downloadStatusKey = ["download-status"] as const;

export function isDownloadActive(state: string | undefined) {
  return state === "downloading" || state === "verifying" || state === "activating";
}

/** Consumers declare their resource dependency on the query instead of coupling this manager to domains. */
function invalidateResources(ids: string[]) {
  return queryClient.invalidateQueries({
    predicate: (query) =>
      (typeof query.meta?.downloadableResource === "string" &&
        ids.includes(query.meta.downloadableResource)) ||
      (Array.isArray(query.meta?.downloadableResources) &&
        query.meta.downloadableResources.some((id) => typeof id === "string" && ids.includes(id))),
  });
}

/** Resource activation changes lookup generations, including when the manager is reopened later. */
function acceptStatus(result: DownloadStatus) {
  const previous = queryClient.getQueryData<DownloadStatus>(downloadStatusKey);
  const changed = result.resources
    .filter((resource) => {
      const old = previous?.resources.find((item) => item.id === resource.id);
      return (
        old?.installedVersion !== resource.installedVersion ||
        (old?.loading === true && !resource.loading) ||
        old?.components.some(
          (component) =>
            component.installed !==
            resource.components.find((item) => item.id === component.id)?.installed,
        ) ||
        (old?.install?.state !== resource.install?.state && resource.install?.state === "complete")
      );
    })
    .map((resource) => resource.id);
  for (const resource of previous?.resources ?? []) {
    if (!result.resources.some((current) => current.id === resource.id)) changed.push(resource.id);
  }
  if (changed.length) void invalidateResources(changed);
  return result;
}

export const downloadsApi = {
  async status() {
    return acceptStatus(await invokeHost<DownloadStatus>("get_download_status"));
  },
  async refresh() {
    const status = acceptStatus(await invokeHost<DownloadStatus>("refresh_download_catalog"));
    queryClient.setQueryData(downloadStatusKey, status);
    return status;
  },
  async install(resourceId: string, components: string[]) {
    await invalidateResources([resourceId]);
    await invokeHost("install_download", { resourceId, components });
    await queryClient.invalidateQueries({ queryKey: downloadStatusKey });
  },
  async cancel(resourceId: string) {
    await invokeHost("cancel_download", { resourceId });
    await queryClient.invalidateQueries({ queryKey: downloadStatusKey });
  },
  async uninstall(resourceId: string) {
    await invalidateResources([resourceId]);
    const status = acceptStatus(
      await invokeHost<DownloadStatus>("uninstall_download", { resourceId }),
    );
    queryClient.setQueryData(downloadStatusKey, status);
  },
};
