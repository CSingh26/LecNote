import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { FileAudio, Upload } from "lucide-react";
import { ActionMenu } from "./ActionMenu";

const setup = () => {
  const upload = vi.fn();
  const transcript = vi.fn();
  render(
    <ActionMenu
      label="Add lecture"
      items={[
        {
          id: "upload",
          label: "Upload recording",
          icon: FileAudio,
          onSelect: upload,
        },
        {
          id: "transcript",
          label: "Import transcript",
          icon: Upload,
          onSelect: transcript,
        },
        {
          id: "disabled",
          label: "Unavailable",
          icon: Upload,
          onSelect: vi.fn(),
          disabled: true,
        },
      ]}
    />,
  );
  return { upload, transcript };
};

it("opens a labelled menu and runs the chosen command", async () => {
  const { transcript } = setup();
  const user = userEvent.setup();
  const button = screen.getByRole("button", { name: "Add lecture" });
  expect(button).toHaveAttribute("aria-expanded", "false");
  await user.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("menu", { name: "Add lecture" })).toBeVisible();
  expect(
    screen.getByRole("menuitem", { name: "Upload recording" }),
  ).toHaveFocus();
  await user.click(screen.getByRole("menuitem", { name: "Import transcript" }));
  expect(transcript).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("supports arrow keys, Escape, and focus restoration", async () => {
  const { upload } = setup();
  const user = userEvent.setup();
  const button = screen.getByRole("button", { name: "Add lecture" });
  button.focus();
  await user.keyboard("{Enter}");
  expect(
    screen.getByRole("menuitem", { name: "Upload recording" }),
  ).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(
    screen.getByRole("menuitem", { name: "Import transcript" }),
  ).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(
    screen.getByRole("menuitem", { name: "Upload recording" }),
  ).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(button).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  await user.keyboard("{Enter}");
  expect(upload).toHaveBeenCalledOnce();
  expect(button).toHaveFocus();
});

it("closes when focus or pointer leaves the menu", async () => {
  setup();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add lecture" }));
  await user.click(document.body);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
