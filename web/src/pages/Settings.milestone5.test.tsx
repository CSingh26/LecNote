import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { Settings as SettingsData } from "../types";
import { Settings } from "./Settings";

const settings: SettingsData = {
  model: "custom-model",
  whisper_model: "base",
  chunk_minutes: 5,
  parallel_requests: 1,
  language: "en",
  diarization: false,
  api_key_configured: false,
  hf_token_configured: false,
  input_price_per_million: 0,
  output_price_per_million: 0,
  capabilities: { whisper: true, ffmpeg: true, ocr: false, diarization: false },
};
afterEach(() => vi.unstubAllGlobals());

it("defaults optimization on and saves an explicit opt-out while retaining a custom model", async () => {
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ ...settings, optimize_recordings: false })),
  );
  vi.stubGlobal("fetch", fetch);
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(
    <Settings
      settings={settings}
      error=""
      refresh={vi.fn()}
      onSaved={onSaved}
    />,
  );
  const optimize = screen.getByRole("checkbox", {
    name: /compress recordings automatically after six hours/i,
  });
  expect(optimize).toBeChecked();
  expect(screen.getByLabelText("OpenAI model")).toHaveValue("custom-model");
  await user.click(optimize);
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByText("Settings saved.");
  expect(fetch).toHaveBeenCalledWith(
    "/api/settings",
    expect.objectContaining({ method: "PUT" }),
  );
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({
    optimize_recordings: false,
    model: "custom-model",
  });
  expect(onSaved).toHaveBeenCalledOnce();
  expect(optimize).not.toBeChecked();
});

it("retains a saved optimization opt-out and uses the default model for an empty value", () => {
  render(
    <Settings
      settings={{ ...settings, model: "", optimize_recordings: false }}
      error=""
      refresh={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("checkbox", {
      name: /compress recordings automatically after six hours/i,
    }),
  ).not.toBeChecked();
  expect(screen.getByLabelText("OpenAI model")).toHaveValue("gpt-5.4-mini");
});
