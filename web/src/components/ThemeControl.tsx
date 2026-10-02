import { SunMoon } from "lucide-react";
import { useTheme, type ThemePreference } from "../lib/theme";

export function ThemeControl() {
  const [preference, chooseTheme] = useTheme();
  return (
    <label className="theme-control">
      <span>
        <SunMoon size={15} aria-hidden="true" />
        Color theme
      </span>
      <select
        value={preference}
        onChange={(event) => chooseTheme(event.target.value as ThemePreference)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
