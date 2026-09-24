import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Library } from "./Library";
import { recording } from "../components/Milestone5.fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("opens merge from the library and navigates to the newly created lecture", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify(
          init?.method === "POST"
            ? { ...recording, id: "merged" }
            : [recording, { ...recording, id: "two", title: "Part two" }],
        ),
      );
    }),
  );
  const user = userEvent.setup();
  render(<Library courses={[]} onNew={vi.fn()} version={0} />);
  await screen.findByText("Part one");
  await user.click(screen.getByRole("button", { name: "Merge recordings" }));
  const dialog = within(screen.getByRole("dialog"));
  await user.type(dialog.getByLabelText("Merged lecture title"), "Combined");
  await user.click(dialog.getByRole("checkbox", { name: /Part one/ }));
  await user.click(dialog.getByRole("checkbox", { name: /Part two/ }));
  await user.click(dialog.getByRole("button", { name: "Merge recordings" }));
  expect(window.location.hash).toBe("#/lecture/merged");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    requests.filter((request) => request.init?.method === "POST"),
  ).toHaveLength(1);
});
