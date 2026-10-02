import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeControl } from "./ThemeControl";

function systemTheme(initiallyDark: boolean) {
  const media = new EventTarget();
  let dark = initiallyDark;
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === "(prefers-color-scheme: dark)" && dark;
    },
    media: query,
    addEventListener: media.addEventListener.bind(media),
    removeEventListener: media.removeEventListener.bind(media),
  }));
  return (nextDark: boolean) => {
    dark = nextDark;
    act(() => media.dispatchEvent(new Event("change")));
  };
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});
afterEach(() => vi.unstubAllGlobals());

it("saves an explicit choice and restores it when the control remounts", async () => {
  systemTheme(false);
  const user = userEvent.setup();
  const { unmount } = render(<ThemeControl />);

  await user.selectOptions(
    screen.getByRole("combobox", { name: "Color theme" }),
    "dark",
  );
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(localStorage.getItem("lecnote-theme")).toBe("dark");

  unmount();
  render(<ThemeControl />);
  expect(screen.getByRole("combobox", { name: "Color theme" })).toHaveValue(
    "dark",
  );
  expect(document.documentElement.dataset.theme).toBe("dark");
});

it("tracks system changes only while System is selected", async () => {
  const changeSystem = systemTheme(true);
  const user = userEvent.setup();
  render(<ThemeControl />);
  const control = screen.getByRole("combobox", { name: "Color theme" });

  expect(control).toHaveValue("system");
  expect(document.documentElement.dataset.theme).toBe("dark");
  changeSystem(false);
  expect(document.documentElement.dataset.theme).toBe("light");

  await user.selectOptions(control, "light");
  changeSystem(true);
  expect(document.documentElement.dataset.theme).toBe("light");

  await user.selectOptions(control, "system");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("lecnote-theme")).toBe("system");
  changeSystem(false);
  expect(document.documentElement.dataset.theme).toBe("light");
});

it("uses the system theme when the stored preference is invalid", () => {
  systemTheme(true);
  localStorage.setItem("lecnote-theme", "obsolete-value");
  render(<ThemeControl />);
  expect(screen.getByRole("combobox", { name: "Color theme" })).toHaveValue(
    "system",
  );
  expect(document.documentElement.dataset.theme).toBe("dark");
});

it("still follows the system and accepts choices when storage is unavailable", async () => {
  systemTheme(true);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Storage unavailable", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage unavailable", "SecurityError");
  });
  const user = userEvent.setup();
  render(<ThemeControl />);
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Color theme" }),
    "light",
  );
  expect(document.documentElement.dataset.theme).toBe("light");
});

it("falls back to light when the browser cannot report a system theme", () => {
  vi.stubGlobal("matchMedia", undefined);
  render(<ThemeControl />);
  expect(document.documentElement.dataset.theme).toBe("light");
});
