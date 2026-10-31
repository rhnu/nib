import { Toast } from "@base-ui/react/toast";
import { X } from "lucide-react";
import { t, useTranslation } from "@/shared/i18n";
import "./notifications.css";

const manager = Toast.createToastManager<{ message: () => string }>();

/** Transient feedback shares one viewport and retains translated message semantics. */
export function notify(message: () => string, id?: string, error = false) {
  manager.add({
    id,
    data: { message },
    type: error ? "error" : "success",
    timeout: error ? 0 : 3000,
  });
}

function NotificationList() {
  useTranslation();
  const { toasts } = Toast.useToastManager<{ message: () => string }>();
  return toasts.map((toast) => (
    <Toast.Root key={toast.id} toast={toast} className="notification" data-severity={toast.type}>
      <Toast.Content>
        <Toast.Title>{toast.data?.message()}</Toast.Title>
      </Toast.Content>
      <Toast.Close className="icon-button" aria-label={t("common.close")}>
        <X size={14} aria-hidden />
      </Toast.Close>
    </Toast.Root>
  ));
}

export function Notifications() {
  return (
    <Toast.Provider toastManager={manager} limit={3}>
      <Toast.Portal>
        <Toast.Viewport className="notification-viewport">
          <NotificationList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
