import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { AppInfo } from "./bindings/app-info";
import { getAppInfo } from "./app-info";

type StartupState =
  | { status: "browser" }
  | { status: "loading" }
  | { status: "ready"; info: AppInfo }
  | { status: "error" };

/** Show the desktop host's startup information and connection state. */
export default function App() {
  const [state, setState] = useState<StartupState>(() => ({
    status: isTauri() ? "loading" : "browser",
  }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    // Each effect owns its response, including StrictMode's initial replay.
    let active = true;

    void getAppInfo().then(
      (info) => {
        if (active) {
          setState({ status: "ready", info });
        }
      },
      (error: unknown) => {
        if (active) {
          console.error("Failed to load application information.", error);
          setState({ status: "error" });
        }
      },
    );

    return () => {
      active = false;
    };
  }, [attempt]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((previous) => previous + 1);
  }

  return (
    <main className="startup">
      <section className="startup-panel" aria-labelledby="app-title">
        <header>
          <h1 id="app-title">{state.status === "ready" ? state.info.name : "nib"}</h1>
          <p className="subtitle">启动信息</p>
        </header>

        <div aria-live="polite" aria-atomic="true" aria-busy={state.status === "loading"}>
          {state.status === "loading" && <p className="message">正在读取应用信息…</p>}

          {state.status === "browser" && (
            <p className="message">
              当前在浏览器中运行，未连接桌面宿主。请通过桌面应用查看启动信息。
            </p>
          )}

          {state.status === "error" && (
            <div className="error-state">
              <p className="message">无法读取应用信息，请重试。</p>
              <button type="button" onClick={retry}>
                重新读取
              </button>
            </div>
          )}

          {state.status === "ready" && (
            <dl className="app-info">
              <div>
                <dt>应用版本</dt>
                <dd>{state.info.version}</dd>
              </div>
              <div>
                <dt>默认模型</dt>
                <dd>{state.info.defaultModelId}</dd>
              </div>
            </dl>
          )}
        </div>
      </section>
    </main>
  );
}
