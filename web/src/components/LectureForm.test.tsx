import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { LectureForm } from "./LectureForm";

it("preserves a title typed while a transcript file is still being read", async () => {
  let finish: (value: string) => void = () => {};
  const content = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const file = new File(["text"], "transcript.txt", { type: "text/plain" });
  Object.defineProperty(file, "text", { value: () => content });
  const user = userEvent.setup();
  render(
    <LectureForm
      courses={[]}
      initialMode="transcript"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  await user.upload(screen.getByLabelText("Transcript file"), file);
  await user.type(screen.getByLabelText("Lecture title"), "Energy of motion");
  await act(async () => {
    finish("[00:00] Kinetic energy");
    await content;
  });
  expect(screen.getByLabelText("Lecture title")).toHaveValue(
    "Energy of motion",
  );
  expect(screen.getByLabelText("Transcript text")).toHaveValue(
    "[00:00] Kinetic energy",
  );
});
