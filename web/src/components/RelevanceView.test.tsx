import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { RelevanceView } from "./RelevanceView";
import { recording } from "./Milestone5.fixtures";

const lecture = {
  ...recording,
  transcript: {
    language: "en",
    duration: 60,
    segments: [
      { id: 0, start: 0, end: 15, text: "Kinetic energy", speaker: null },
      { id: 1, start: 15, end: 30, text: "Exam next week", speaker: null },
      { id: 2, start: 30, end: 45, text: "Uncertain aside", speaker: null },
      { id: 3, start: 45, end: 60, text: "Unclassified ending", speaker: null },
    ],
  },
  relevance: {
    segments: [
      {
        segment_id: 0,
        start: 0,
        end: 15,
        category: "course_material",
        reason: "Core concept",
      },
      {
        segment_id: 1,
        start: 15,
        end: 30,
        category: "class_logistics",
        reason: "Schedule",
      },
      {
        segment_id: 2,
        start: 30,
        end: 45,
        category: "needs_review",
        reason: "Uncertain",
      },
    ],
  },
  relevance_overrides: { "1": "off_topic" },
};
afterEach(() => vi.unstubAllGlobals());

it("keeps all transcript rows available, counts effective categories and seeks with a keyboard", async () => {
  const user = userEvent.setup();
  const onSeek = vi.fn();
  render(<RelevanceView lecture={lecture} onSaved={vi.fn()} onSeek={onSeek} />);
  expect(screen.getByText("Unclassified ending")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Needs review (2)" }));
  expect(screen.getByText("Uncertain aside")).toBeVisible();
  expect(screen.queryByText("Kinetic energy")).not.toBeInTheDocument();
  screen.getByRole("button", { name: "Seek to 0:30" }).focus();
  await user.keyboard("{Enter}");
  expect(onSeek).toHaveBeenCalledWith(30);
  await user.click(screen.getByRole("button", { name: "Off topic (1)" }));
  expect(screen.getByText("Exam next week")).toBeVisible();
});

it("saves the entire override mapping and preserves sequential corrections across refreshes", async () => {
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(lecture)),
  );
  vi.stubGlobal("fetch", fetch);
  const onSaved = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <RelevanceView lecture={lecture} onSaved={onSaved} onSeek={vi.fn()} />,
  );
  await user.selectOptions(
    screen.getByLabelText("Category for segment 0"),
    "needs_review",
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledWith(
    "/api/lectures/one/relevance",
    expect.objectContaining({ method: "PUT" }),
  );
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({
    overrides: { "0": "needs_review", "1": "off_topic" },
  });
  view.rerender(
    <RelevanceView
      lecture={{ ...lecture }}
      onSaved={onSaved}
      onSeek={vi.fn()}
    />,
  );
  await user.selectOptions(
    screen.getByLabelText("Category for segment 2"),
    "course_material",
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({
    overrides: {
      "0": "needs_review",
      "1": "off_topic",
      "2": "course_material",
    },
  });
  expect(screen.getByRole("status")).toHaveTextContent(/notes.*out of date/i);
  expect(screen.getByText("Uncertain aside")).toBeVisible();
});

it("restores the saved category on error without deleting transcript text", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: "Lecture is busy" }), {
          status: 409,
        }),
    ),
  );
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(
    <RelevanceView lecture={lecture} onSaved={onSaved} onSeek={vi.fn()} />,
  );
  await user.selectOptions(
    screen.getByLabelText("Category for segment 0"),
    "off_topic",
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Lecture is busy");
  expect(screen.getByLabelText("Category for segment 0")).toHaveValue(
    "course_material",
  );
  expect(screen.getByText("Kinetic energy")).toBeVisible();
  expect(onSaved).not.toHaveBeenCalled();
});

it("locks category controls until a pending save finishes and accepts server refreshes", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const user = userEvent.setup();
  const props = { onSaved: vi.fn(), onSeek: vi.fn() };
  const view = render(<RelevanceView lecture={lecture} {...props} />);
  await user.selectOptions(
    screen.getByLabelText("Category for segment 0"),
    "class_logistics",
  );
  for (const select of screen.getAllByRole("combobox"))
    expect(select).toBeDisabled();
  const savedLecture = {
    ...lecture,
    relevance_overrides: { "0": "class_logistics", "1": "off_topic" },
  };
  await act(async () => {
    finish(new Response(JSON.stringify(savedLecture)));
  });
  view.rerender(<RelevanceView lecture={savedLecture} {...props} />);
  expect(screen.getByLabelText("Category for segment 0")).toHaveValue(
    "class_logistics",
  );
  view.rerender(
    <RelevanceView
      lecture={{ ...savedLecture, status: "generating" }}
      {...props}
    />,
  );
  for (const select of screen.getAllByRole("combobox"))
    expect(select).toBeDisabled();
});
