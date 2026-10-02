import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const html = readFileSync("index.html", "utf8");
const bootstrap =
  new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector("script#theme-bootstrap")?.textContent ?? "";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  { saved: "dark", systemDark: false, theme: "dark" },
  { saved: "light", systemDark: true, theme: "light" },
  { saved: "system", systemDark: true, theme: "dark" },
  { saved: "invalid", systemDark: true, theme: "dark" },
  { saved: null, systemDark: false, theme: "light" },
])(
  "applies $theme before React starts with preference $saved",
  ({ saved, systemDark, theme }) => {
    if (saved) localStorage.setItem("lecnote-theme", saved);
    vi.stubGlobal("matchMedia", () => ({ matches: systemDark }));
    window.eval(bootstrap);
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(document.documentElement.style.colorScheme).toBe(theme);
  },
);

it("applies the system preference before rendering when storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Storage unavailable", "SecurityError");
  });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  window.eval(bootstrap);
  expect(document.documentElement.dataset.theme).toBe("dark");
});

it("starts in light when both storage and system preference APIs are unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Storage unavailable", "SecurityError");
  });
  vi.stubGlobal("matchMedia", undefined);
  window.eval(bootstrap);
  expect(document.documentElement.dataset.theme).toBe("light");
});
