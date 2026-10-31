import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DownloadableResourceStatus } from "@/bindings/downloads";
import { ActionsMenu, Button, HelpMarker, Modal, Notice } from "@/shared/ui";
import { t, useMessageState, useTranslation } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { downloadsApi, downloadStatusKey, isDownloadActive } from "./api";
import {
  componentDescription,
  componentName,
  formatBytes,
  resourceDescription,
  resourceName,
} from "./labels";
import { initialComponents, selectComponents } from "./selection";
import "./styles.css";

/** The host owns downloads; local state only holds the next explicit component selection. */
function ResourceDownload({ resource }: { resource: DownloadableResourceStatus }) {
  const [selected, setSelected] = useState(() =>
    initialComponents(
      resource.components,
      resource.install?.state === "complete" ? undefined : resource.install?.components,
    ),
  );
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<"uninstall" | "replace" | null>(null);
  const [error, setError] = useMessageState();
  const active = isDownloadActive(resource.install?.state);
  const name = resourceName(resource.id, resource.name);
  const installed = Boolean(resource.installedVersion);
  const changed = resource.components.some(
    (component) => component.installed !== selected.includes(component.id),
  );
  const removed = resource.components.filter(
    (component) => component.installed && !selected.includes(component.id),
  );
  const selectedBytes = resource.components.reduce(
    (total, component) => total + (selected.includes(component.id) ? component.bytes : 0),
    0,
  );
  const states = {
    downloading: t("downloads.downloading"),
    verifying: t("downloads.verifying"),
    activating: t("downloads.activating"),
    complete: t("downloads.complete"),
    cancelled: t("downloads.cancelled"),
    failed: t("downloads.failed"),
  };

  const run = async (operation: () => Promise<void>) => {
    setPending(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  };

  const install = () => run(() => downloadsApi.install(resource.id, selected));

  const actionable =
    !installed ||
    changed ||
    resource.installedVersion !== resource.version ||
    resource.install?.state === "failed" ||
    resource.install?.state === "cancelled";

  const action =
    resource.install?.state === "failed" || resource.install?.state === "cancelled"
      ? t("downloads.retry")
      : !installed
        ? t("downloads.install")
        : resource.installedVersion !== resource.version
          ? t("downloads.update")
          : changed
            ? t("downloads.applyComponents")
            : t("downloads.reinstall");

  const componentLabel = (id: string) =>
    componentName(
      resource.id,
      id,
      resource.components.find((component) => component.id === id)?.name ?? id,
    );

  return (
    <section className="download-resource" aria-label={name}>
      <div className="section-heading">
        <h3>
          {name}
          <HelpMarker label={name}>
            {resourceDescription(resource.id, resource.description)}
          </HelpMarker>
        </h3>
        {installed && (
          <ActionsMenu
            label={t("downloads.actions", { name })}
            items={[
              {
                label: t("downloads.reinstall"),
                disabled: pending || active || !selected.length,
                action: () => (removed.length ? setConfirm("replace") : void install()),
              },
              {
                label: t("downloads.uninstall"),
                danger: true,
                disabled: pending || active,
                action: () => setConfirm("uninstall"),
              },
            ]}
          />
        )}
      </div>
      <div className="download-versions">
        <span>
          {resource.installedVersion
            ? t("downloads.installedVersion", { version: resource.installedVersion })
            : t("downloads.notInstalled")}
        </span>
        <span>{t("downloads.availableVersion", { version: resource.version })}</span>
      </div>
      <fieldset className="download-components" disabled={pending || active}>
        <legend>{t("downloads.components")}</legend>
        {resource.components.map((component) => (
          <label className="download-component" key={component.id}>
            <input
              type="checkbox"
              checked={selected.includes(component.id)}
              onChange={(event) =>
                setSelected(
                  selectComponents(
                    resource.components,
                    selected,
                    component.id,
                    event.target.checked,
                  ),
                )
              }
            />
            <span className="download-component-body">
              <span className="download-component-heading">
                <strong>{componentLabel(component.id)}</strong>
                {component.installed && <span className="tag">{t("downloads.installed")}</span>}
              </span>
              <span className="download-component-description">
                {componentDescription(resource.id, component.id, component.description)}
              </span>
              {component.requires.length > 0 && (
                <span className="download-dependencies">
                  {t("downloads.requires", {
                    names: component.requires.map(componentLabel).join(", "),
                  })}
                </span>
              )}
            </span>
            <span className="download-component-size">{formatBytes(component.bytes)}</span>
          </label>
        ))}
      </fieldset>
      <div className="download-actions">
        {!active && (
          <span className="download-selection-size">
            {t("downloads.selectedSize", {
              count: selected.length,
              size: formatBytes(selectedBytes),
            })}
          </span>
        )}
        {active ? (
          <Button
            disabled={pending}
            onClick={() => void run(() => downloadsApi.cancel(resource.id))}
          >
            {t("downloads.cancel")}
          </Button>
        ) : actionable ? (
          <Button
            className="primary"
            disabled={pending || !selected.length}
            onClick={() => (removed.length ? setConfirm("replace") : void install())}
          >
            {action}
          </Button>
        ) : null}
      </div>
      {resource.install && (
        <output className="download-progress" aria-live="polite">
          <span>{states[resource.install.state]}</span>
          {active && (
            <>
              <progress
                max={resource.install.totalBytes || undefined}
                value={resource.install.totalBytes ? resource.install.completedBytes : undefined}
                aria-label={states[resource.install.state]}
              />
              <span>
                {resource.install.totalBytes
                  ? t("downloads.progress", {
                      completed: formatBytes(resource.install.completedBytes),
                      total: formatBytes(resource.install.totalBytes),
                    })
                  : formatBytes(resource.install.completedBytes)}
              </span>
            </>
          )}
          {resource.install.message && <Notice>{resource.install.message}</Notice>}
        </output>
      )}
      {error && <Notice>{error}</Notice>}
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm === "uninstall"
            ? t("downloads.uninstallTitle", { name })
            : t("downloads.replaceTitle")
        }
      >
        <p className="confirm-copy">
          {confirm === "uninstall"
            ? t("downloads.uninstallImpact", { name })
            : t("downloads.replaceImpact")}
        </p>
        <ul className="download-impact">
          {(confirm === "uninstall"
            ? resource.components.filter((component) => component.installed)
            : removed
          ).map((component) => (
            <li key={component.id}>
              <strong>{componentLabel(component.id)}</strong> —{" "}
              {componentDescription(resource.id, component.id, component.description)}
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <Button onClick={() => setConfirm(null)}>{t("app.cancel")}</Button>
          <Button
            className="danger-button"
            onClick={() => {
              const operation =
                confirm === "uninstall"
                  ? () => downloadsApi.uninstall(resource.id)
                  : () => downloadsApi.install(resource.id, selected);
              setConfirm(null);
              void run(operation);
            }}
          >
            {confirm === "uninstall" ? t("downloads.uninstall") : t("downloads.applyComponents")}
          </Button>
        </div>
      </Modal>
    </section>
  );
}

/** Settings owns resource management; installation tasks continue outside this page. */
export function DownloadsSettings() {
  useTranslation();
  const status = useQuery({
    queryKey: downloadStatusKey,
    queryFn: downloadsApi.status,
    staleTime: 1_000,
    refetchInterval: (query) =>
      query.state.data?.resources.some((resource) => isDownloadActive(resource.install?.state))
        ? 500
        : false,
    retry: false,
  });
  const catalog = useQuery({
    queryKey: ["download-catalog"],
    queryFn: downloadsApi.refresh,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  return (
    <section className="downloads-settings">
      <div className="section-heading">
        <h2>{t("downloads.title")}</h2>
        <Button disabled={catalog.isFetching} onClick={() => void catalog.refetch()}>
          {catalog.isFetching ? t("downloads.refreshing") : t("downloads.refresh")}
        </Button>
      </div>
      {status.isPending && <output>{t("downloads.loading")}</output>}
      {status.error && (
        <Notice
          actions={<Button onClick={() => void status.refetch()}>{t("downloads.retry")}</Button>}
        >
          {errorMessage(status.error)}
        </Notice>
      )}
      {status.data?.catalogError && <Notice>{status.data.catalogError}</Notice>}
      {catalog.error && <Notice>{errorMessage(catalog.error)}</Notice>}
      {status.data &&
        !catalog.isFetching &&
        !status.data.resources.length &&
        !status.data.catalogError && <p>{t("downloads.empty")}</p>}
      {status.data?.resources.map((resource) => (
        <ResourceDownload
          key={`${resource.id}:${resource.installedVersion}:${resource.components.map((component) => `${component.id}-${component.installed}`).join(";")}:${resource.install?.components.join(";") ?? ""}`}
          resource={resource}
        />
      ))}
      {status.data?.directory && (
        <div className="download-directory">
          <span>{t("downloads.directory")}</span>
          <code>{status.data.directory}</code>
        </div>
      )}
    </section>
  );
}
