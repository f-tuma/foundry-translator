import { useEffect, useState } from "react";
import { ChevronDown, Monitor, Moon, Sun } from "lucide-react";

type Theme = "dark" | "light" | "system";
const storageKey = "ember.community.theme.v1";
const isTheme = (value: unknown): value is Theme =>
  value === "dark" || value === "light" || value === "system";
const readTheme = (): Theme => {
  try {
    const value = localStorage.getItem(storageKey);
    return isTheme(value) ? value : "dark";
  } catch {
    return "dark";
  }
};

// Runs before the first paint; the React control then owns changes and OS updates.
export const themeBootstrap = `(()=>{let t="dark";try{const v=localStorage.getItem("${storageKey}");if(["dark","light","system"].includes(v))t=v}catch{}document.documentElement.dataset.theme=t==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t})()`;

export function ThemeControl() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    const sync = () => setTheme(readTheme());
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    if (!theme) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  const Icon = theme === "light" ? Sun : theme === "system" ? Monitor : Moon;
  return (
    <label className="theme-control">
      <Icon size={16} aria-hidden="true" />
      <select
        aria-label="Barevný režim"
        value={theme ?? "dark"}
        onChange={(event) => {
          const value = event.target.value;
          if (!isTheme(value)) return;
          setTheme(value);
          try {
            localStorage.setItem(storageKey, value);
          } catch {
            // The preference still works for this page when storage is disabled.
          }
        }}
      >
        <option value="dark">Tmavý</option>
        <option value="light">Světlý</option>
        <option value="system">Systém</option>
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </label>
  );
}
