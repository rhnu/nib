import { useEffect, useState } from "react";
export function useTheme() {
  const [theme, setTheme] = useState(() =>
    localStorage.getItem("nib-theme") === "light" ? "light" : "dark",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("nib-theme", theme);
  }, [theme]);
  return { theme, toggleTheme: () => setTheme((value) => (value === "dark" ? "light" : "dark")) };
}
