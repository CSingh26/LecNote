import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
const storageKey = "lecnote-theme";

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Browsers may block storage; the system theme remains available.
  }
  return "system";
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    const system = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme =
        preference === "system"
          ? system?.matches
            ? "dark"
            : "light"
          : preference;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    };
    apply();
    if (preference !== "system") return;
    system?.addEventListener("change", apply);
    return () => system?.removeEventListener("change", apply);
  }, [preference]);

  const chooseTheme = (next: ThemePreference) => {
    setPreference(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // A choice still applies for this session when it cannot be saved.
    }
  };

  return [preference, chooseTheme] as const;
}
