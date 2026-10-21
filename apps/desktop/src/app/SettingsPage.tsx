import { Moon, Sun } from "lucide-react";
import { AccountSettings } from "../features/generation";
import { Button } from "../shared/ui";

export function SettingsPage({ theme, toggleTheme }: { theme: string; toggleTheme: () => void }) {
  return (
    <main className="settings-page" aria-label="设置">
      <header className="page-toolbar">
        <h1>设置</h1>
      </header>
      <div className="settings-page-content">
        <section className="preference-section">
          <h2>账户</h2>
          <AccountSettings />
        </section>
        <section className="preference-section">
          <h2>外观</h2>
          <div className="preference-row">
            <span>主题</span>
            <Button onClick={toggleTheme}>
              {theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
              {theme === "dark" ? "切换浅色" : "切换深色"}
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
