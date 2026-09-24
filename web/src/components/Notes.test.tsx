import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Lecture } from "../types";
import { NotesView } from "./Notes";
import { Markdown } from "./Markdown";

const lecture: Lecture = {
  id: "notes-test",
  course_id: null,
  source_name: "Imported transcript",
  media_type: "",
  status: "ready",
  duration: 0,
  created_at: "2026-09-23",
  updated_at: "2026-09-23",
  context: "",
  language: "en",
  transcript: null,
  attachments: [],
  error: null,
  job: null,
  title: "A lecture",
  user_notes: "",
  notes: {
    title: "A lecture",
    overview: "Summary",
    takeaways: [],
    chunks: [],
    glossary: [],
    review_questions: [],
    model: "test-model",
    usage: { input_tokens: 1000, output_tokens: 500 },
  },
};
const props = {
  lecture,
  onSeek: () => {},
  onSaved: () => {},
  onDirty: () => {},
};
it("shows the saved generation sources rather than current preparation", () => {
  render(
    <NotesView
      {...props}
      lecture={{
        ...lecture,
        context: "New preparation",
        notes: {
          ...lecture.notes!,
          provenance: {
            context: "Original focus",
            resource_provenance: [
              { id: "source", name: "Week 3 slides", revision: 2 },
            ],
          },
        },
      }}
    />,
  );
  expect(screen.getByText("Used for these notes")).toBeInTheDocument();
  expect(screen.getByText("Original focus")).toBeInTheDocument();
  expect(screen.getByText(/Week 3 slides.*Revision 2/)).toBeInTheDocument();
  expect(screen.queryByText("New preparation")).not.toBeInTheDocument();
});
it("shows a saved-generation estimate only when both prices are configured", () => {
  const view = render(
    <NotesView
      {...props}
      prices={{ input_price_per_million: 2, output_price_per_million: 4 }}
    />,
  );
  expect(
    screen.getByText(/Estimated cost for these saved notes: \$0\.0040/),
  ).toBeInTheDocument();
  view.rerender(
    <NotesView
      {...props}
      prices={{ input_price_per_million: 2, output_price_per_million: 0 }}
    />,
  );
  expect(
    screen.queryByText(/Estimated cost for these saved notes/),
  ).not.toBeInTheDocument();
});
it("does not inject raw HTML or unsafe links in note Markdown", () => {
  const { container } = render(
    <Markdown>
      {
        '<img src=x onerror="alert(1)">\n\n[unsafe](javascript:alert(1))\n\n**Safe text**'
      }
    </Markdown>,
  );
  expect(container.querySelector("img,script")).toBeNull();
  expect(container.querySelector("a")?.getAttribute("href")).not.toContain(
    "javascript:",
  );
  expect(screen.getByText("Safe text")).toBeInTheDocument();
});
