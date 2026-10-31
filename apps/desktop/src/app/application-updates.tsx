import { useTranslation, t } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { Button, Modal, Notice, SettingRow, SettingsGroup } from "@/shared/ui";
import type { ApplicationUpdates } from "./use-application-updates";

function UpdateDetails({ updates }: { updates: ApplicationUpdates }) {
  useTranslation();
  const { status, operation } = updates;
  return (
    <>
      {status?.release && <p>{t("updates.available", { version: status.release.version })}</p>}
      {status?.release?.notes && (
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{status.release.notes}</p>
      )}
      {operation === "downloading" && (
        <output>
          <p>{t("updates.downloading")}</p>
          <p>{t("updates.bytes", { count: status?.downloaded ?? 0 })}</p>
          <progress
            aria-label={t("updates.downloading")}
            value={status?.total ? status.downloaded : undefined}
            max={status?.total ?? undefined}
          />
        </output>
      )}
      {operation === "preparing" && <output>{t("updates.installing")}</output>}
      {status?.phase === "ready" && <p>{t("updates.ready")}</p>}
      {updates.error && (
        <Notice>{t("updates.failed", { detail: errorMessage(updates.error) })}</Notice>
      )}
    </>
  );
}

export function ApplicationUpdateDialog({ updates }: { updates: ApplicationUpdates }) {
  useTranslation();
  return (
    <Modal
      open={updates.open}
      onClose={() => {
        if (!updates.operation) updates.setOpen(false);
      }}
      title={t("updates.title")}
      showClose={!updates.operation}
    >
      <UpdateDetails updates={updates} />
      <div className="ui-actions">
        <Button disabled={Boolean(updates.operation)} onClick={() => updates.setOpen(false)}>
          {t("updates.later")}
        </Button>
        <Button
          disabled={Boolean(updates.operation) || !updates.status?.release}
          onClick={() => void updates.install()}
        >
          {updates.status?.phase === "ready" ? t("updates.install") : t("updates.download")}
        </Button>
      </div>
    </Modal>
  );
}

export function ApplicationUpdateSettings({ updates }: { updates: ApplicationUpdates }) {
  useTranslation();
  return (
    <SettingsGroup description={t("updates.help")}>
      <SettingRow label={t("updates.current", { version: updates.status?.currentVersion ?? "—" })}>
        <Button
          disabled={!updates.status?.enabled || Boolean(updates.operation)}
          onClick={() => void updates.check()}
        >
          {updates.operation === "checking" ? t("updates.checking") : t("updates.check")}
        </Button>
      </SettingRow>
      {!updates.status?.enabled && <p>{t("updates.disabled")}</p>}
      {updates.checked && !updates.status?.release && !updates.error && (
        <output>{t("updates.latest")}</output>
      )}
      <UpdateDetails updates={updates} />
      {updates.status?.release && (
        <Button disabled={Boolean(updates.operation)} onClick={() => updates.setOpen(true)}>
          {updates.status.phase === "ready" ? t("updates.install") : t("updates.download")}
        </Button>
      )}
    </SettingsGroup>
  );
}
