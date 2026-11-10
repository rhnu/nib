import {
  overlayStyles,
  ActionsMenu,
  Button,
  Toolbar,
  HelpMarker,
  Modal,
  Notice,
  SettingsGroup,
  Row,
  Grid,
  ButtonGroup,
} from "@/shared/ui";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DownloadableResourceStatus } from "@/bindings/downloads";

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
  const unavailable = pending || active;
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
    <SettingsGroup
      className="download-resource"
      title={
        <>
          {name}
          <HelpMarker label={name}>
            {resourceDescription(resource.id, resource.description)}
          </HelpMarker>
        </>
      }
      actions={
        installed && (
          <ActionsMenu
            label={t("downloads.actions", { name })}
            items={[
              {
                label: t("downloads.reinstall"),
                disabled: unavailable || !selected.length,
                action: () => (removed.length ? setConfirm("replace") : void install()),
              },
              {
                label: t("downloads.uninstall"),
                danger: true,
                disabled: unavailable,
                action: () => setConfirm("uninstall"),
              },
            ]}
          />
        )
      }
    >
      <Row
        gap={0}
        align="stretch"
        wrap
        className="download-versions [gap:var(--space-2)_var(--space-5)] text-muted text-label"
      >
        <span>
          {resource.installedVersion
            ? t("downloads.installedVersion", { version: resource.installedVersion })
            : resource.loading
              ? t("downloads.restoring")
              : resource.error
                ? t("downloads.restoreFailed")
                : t("downloads.notInstalled")}
        </span>
        <span>{t("downloads.availableVersion", { version: resource.version })}</span>
      </Row>
      <fieldset
        className="download-components m-0 p-0 [border:0] min-w-0 [&_>_legend]:p-0 [&_>_legend]:mb-space-1 [&_>_legend]:text-label"
        disabled={unavailable}
      >
        <legend>{t("downloads.components")}</legend>
        {resource.components.map((component) => (
          <Grid
            gap={3}
            align="start"
            columns={1}
            as="label"
            className="download-component [grid-template-columns:16px_minmax(0,_1fr)_auto] py-space-4 px-space-3 [border-bottom:1px_solid_var(--line-subtle)] text-label cursor-pointer [&:hover]:bg-hover [&_>_input]:[width:16px] [&_>_input]:[height:16px] [&_>_input]:[margin:2px_0_0] [&_>_input]:p-0 [&_>_input]:[accent-color:var(--accent)] max-[480px]:[grid-template-columns:16px_minmax(0,_1fr)]"
            key={component.id}
          >
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
            <Grid
              align="stretch"
              gap={1}
              columns={1}
              as="span"
              className="download-component-body min-w-0 [overflow-wrap:anywhere]"
            >
              <Row gap={3} align="center" wrap as="span" className="download-component-heading">
                <strong>{componentLabel(component.id)}</strong>
                {component.installed && (
                  <span className="tag inline-flex items-center p-[1px_5px] leading-[19px] text-[10px] rounded-control bg-accent-soft text-accent whitespace-nowrap">
                    {t("downloads.installed")}
                  </span>
                )}
              </Row>
              <span className="download-component-description text-muted">
                {componentDescription(resource.id, component.id, component.description)}
              </span>
              {component.requires.length > 0 && (
                <span className="download-dependencies text-label text-muted">
                  {t("downloads.requires", {
                    names: component.requires.map(componentLabel).join(", "),
                  })}
                </span>
              )}
            </Grid>
            <span className="download-component-size text-muted whitespace-nowrap max-[480px]:[grid-column:2]">
              {formatBytes(component.bytes)}
            </span>
          </Grid>
        ))}
      </fieldset>
      <Toolbar gap={4} align="center" justify="end" wrap className="download-actions">
        {!active && (
          <span className="download-selection-size text-label text-muted mr-auto">
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
            variant="primary"
            disabled={unavailable || !selected.length}
            onClick={() => (removed.length ? setConfirm("replace") : void install())}
          >
            {action}
          </Button>
        ) : null}
      </Toolbar>
      {resource.loading && <output aria-live="polite">{t("downloads.restoring")}</output>}
      {resource.error && <Notice>{resource.error}</Notice>}
      {resource.install && resource.install.state !== "complete" && (
        <Grid
          align="stretch"
          gap={2}
          columns={1}
          as="output"
          className="download-progress mt-0 text-label [&_>_progress]:w-full [&_>_progress]:[accent-color:var(--accent)]"
          aria-live="polite"
        >
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
        </Grid>
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
        <p className={`confirm-copy ${overlayStyles["confirm-copy"]}`}>
          {confirm === "uninstall"
            ? t("downloads.uninstallImpact", { name })
            : t("downloads.replaceImpact")}
        </p>
        <ul className="download-impact pl-[20px] text-label [&_>_li]:my-space-3 [&_>_li]:mx-0">
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
        <ButtonGroup
          gap={3}
          wrap
          justify="end"
          className="dialog-actions flex items-center justify-end flex-wrap gap-space-3 mt-space-4"
        >
          <Button onClick={() => setConfirm(null)}>{t("app.cancel")}</Button>
          <Button
            variant="danger"
            disabled={unavailable}
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
        </ButtonGroup>
      </Modal>
    </SettingsGroup>
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
      query.state.data?.resources.some(
        (resource) => resource.loading || isDownloadActive(resource.install?.state),
      )
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
    <Grid
      align="stretch"
      gap={6}
      columns={1}
      className="downloads-settings w-full min-w-0 [align-content:start]"
    >
      <Row
        gap={0}
        align="center"
        justify="between"
        as="header"
        className="settings-group-heading downloads-heading [&_>_h2]:[font-size:15px]"
      >
        <h2>{t("downloads.title")}</h2>
        <Button disabled={catalog.isFetching} onClick={() => void catalog.refetch()}>
          {catalog.isFetching ? t("downloads.refreshing") : t("downloads.refresh")}
        </Button>
      </Row>
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
        <Grid
          align="stretch"
          gap={1}
          columns={1}
          className="download-directory min-w-0 mt-0 pt-space-4 [border-top:1px_solid_var(--line-subtle)] text-label [&_>_span]:text-muted [&_>_code]:[overflow-wrap:anywhere]"
        >
          <span>{t("downloads.directory")}</span>
          <code>{status.data.directory}</code>
        </Grid>
      )}
    </Grid>
  );
}
