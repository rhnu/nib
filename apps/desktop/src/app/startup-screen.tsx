import { LoaderCircle } from "lucide-react";
import { Button } from "@/shared/ui";
export function StartupScreen({
  loading,
  error,
  retry,
  loadingLabel = "正在打开创作数据…",
}: {
  loading: boolean;
  error: string;
  retry: () => void;
  loadingLabel?: string;
}) {
  return (
    <main className="startup">
      <section className="startup-panel">
        <div className="brand-mark">n</div>
        <h1>nib</h1>
        {loading ? (
          <output className="startup-message">
            <LoaderCircle className="spin" size={17} />
            {loadingLabel}
          </output>
        ) : (
          <>
            <p className="startup-message">
              {error ||
                "当前在独立浏览器中运行，未连接桌面宿主。资源与当前创作需要通过 nib 桌面应用打开。"}
            </p>
            <Button onClick={retry}>重新连接</Button>
            <details>
              <summary>如何打开工作台</summary>
              <p>
                在项目目录运行 <code>pnpm dev</code> 启动桌面应用。<code>pnpm dev:web</code>{" "}
                仅预览前端，无法访问本地资源。
              </p>
            </details>
          </>
        )}
      </section>
    </main>
  );
}
