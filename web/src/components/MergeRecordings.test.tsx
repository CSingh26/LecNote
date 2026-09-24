import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MergeRecordings } from "./MergeRecordings";
import { recording } from "./Milestone5.fixtures";

const second = { ...recording, id: "two", title: "Part two", duration: 120 };
afterEach(() => vi.unstubAllGlobals());

it("merges keyboard-selected parts in displayed order and locks the synchronous request", async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn(
    (_url: string, _init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <MergeRecordings
      lectures={[recording, second]}
      onSaved={onSaved}
      onClose={onClose}
    />,
  );
  await user.type(
    screen.getByLabelText("Merged lecture title"),
    "Combined lecture",
  );
  screen.getByRole("checkbox", { name: /Part one/ }).focus();
  await user.keyboard(" ");
  await user.click(screen.getByRole("checkbox", { name: /Part two/ }));
  screen.getByRole("button", { name: "Move Part two up" }).focus();
  await user.keyboard("{Enter}");
  const order = within(
    screen.getByRole("list", { name: "Merge order" }),
  ).getAllByRole("listitem");
  expect(order[0]).toHaveTextContent("Part two");
  expect(order[1]).toHaveTextContent("Part one");
  expect(screen.getByText(/3:00/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Merge recordings" }));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    "/api/lectures/merge",
    expect.objectContaining({ method: "POST" }),
  );
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({
    lecture_ids: ["two", "one"],
    title: "Combined lecture",
  });
  expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
  expect(screen.getByLabelText("Merged lecture title")).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => {
    finish(new Response(JSON.stringify({ ...recording, id: "merged" })));
  });
  expect(onSaved).toHaveBeenCalledWith(
    expect.objectContaining({ id: "merged" }),
  );
});

it("blocks busy, unassigned, transcript-only and different-course sources", async () => {
  const user = userEvent.setup();
  render(
    <MergeRecordings
      lectures={[
        recording,
        second,
        { ...recording, id: "busy", title: "Live", status: "recording" },
        {
          ...recording,
          id: "processing",
          title: "Processing",
          status: "processing",
        },
        { ...recording, id: "none", title: "Unassigned", course_id: null },
        { ...recording, id: "text", title: "Text", media_type: "" },
        { ...recording, id: "other", title: "Other class", course_id: "math" },
        {
          ...recording,
          id: "job",
          title: "Job running",
          job: {
            id: "j",
            lecture_id: "job",
            status: "running",
            stage: "notes",
            progress: 5,
            message: "",
            error: null,
            created_at: "",
            updated_at: "",
          },
        },
      ]}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  for (const name of [
    "Live",
    "Processing",
    "Unassigned",
    "Text",
    "Job running",
  ])
    expect(
      screen.getByRole("checkbox", { name: new RegExp(name) }),
    ).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /Part one/ }));
  expect(screen.getByRole("checkbox", { name: /Other class/ })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Merge recordings" }),
  ).toBeDisabled();
});

it.each([
  [{ duration: 21600 }, /six hours/i],
  [{ source_bytes: 4 * 1024 ** 3 }, /4 GiB/i],
])("rejects totals above the merge limit", async (extra, warning) => {
  const user = userEvent.setup();
  render(
    <MergeRecordings
      lectures={[
        { ...recording, ...extra },
        { ...second, source_bytes: 1 },
      ]}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await user.type(screen.getByLabelText("Merged lecture title"), "Combined");
  await user.click(screen.getByRole("checkbox", { name: /Part one/ }));
  await user.click(screen.getByRole("checkbox", { name: /Part two/ }));
  expect(screen.getByRole("alert")).toHaveTextContent(warning);
  expect(
    screen.getByRole("button", { name: "Merge recordings" }),
  ).toBeDisabled();
});

it("keeps title and selection after a server rejection and allows correction", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: "Source is busy" }), {
          status: 409,
        }),
    ),
  );
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(
    <MergeRecordings
      lectures={[recording, second]}
      onSaved={vi.fn()}
      onClose={onClose}
    />,
  );
  await user.type(screen.getByLabelText("Merged lecture title"), "Combined");
  await user.click(screen.getByRole("checkbox", { name: /Part one/ }));
  await user.click(screen.getByRole("checkbox", { name: /Part two/ }));
  await user.click(screen.getByRole("button", { name: "Merge recordings" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Source is busy");
  expect(screen.getByLabelText("Merged lecture title")).toHaveValue("Combined");
  expect(screen.getByRole("checkbox", { name: /Part one/ })).toBeChecked();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
});

it("allows exactly 20 parts and frees a slot when a selected part is removed", async () => {
  const user = userEvent.setup();
  render(
    <MergeRecordings
      lectures={Array.from({ length: 21 }, (_, index) => ({
        ...recording,
        id: String(index),
        title: `Part ${index + 1}`,
      }))}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const checkboxes = screen.getAllByRole("checkbox");
  await user.type(screen.getByLabelText("Merged lecture title"), "Combined");
  for (const checkbox of checkboxes.slice(0, 20)) await user.click(checkbox);
  expect(checkboxes[20]).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Merge recordings" }),
  ).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Remove Part 1" }));
  expect(checkboxes[20]).toBeEnabled();
});

it("allows exact duration and size limits but rejects a selected source that becomes busy", async () => {
  const user = userEvent.setup();
  const lectures = [
    { ...recording, duration: 10800, source_bytes: 2 * 1024 ** 3 },
    { ...second, duration: 10800, source_bytes: 2 * 1024 ** 3 },
  ];
  const props = { onSaved: vi.fn(), onClose: vi.fn() };
  const view = render(<MergeRecordings lectures={lectures} {...props} />);
  await user.type(screen.getByLabelText("Merged lecture title"), "Combined");
  await user.click(screen.getByRole("checkbox", { name: /Part one/ }));
  await user.click(screen.getByRole("checkbox", { name: /Part two/ }));
  expect(
    screen.getByRole("button", { name: "Merge recordings" }),
  ).toBeEnabled();
  view.rerender(
    <MergeRecordings
      lectures={[lectures[0], { ...lectures[1], status: "queued" }]}
      {...props}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Merge recordings" }),
  ).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(/unavailable/);
  await user.click(screen.getByRole("button", { name: "Remove Part two" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
