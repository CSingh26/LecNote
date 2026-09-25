import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ClassResources } from "./ClassResources";
import { Courses } from "../pages/Courses";
import type { Course, Resource } from "../types";

const course: Course = {
  id: "math",
  name: "Mathematics",
  code: "M101",
  color: "#235b44",
  context: "",
  vocabulary: "",
  created_at: "2026-09-24",
  lecture_count: 0,
};
const note: Resource = {
  id: "note",
  course_id: "math",
  name: "Exam focus",
  kind: "note",
  text: "Matrices",
  created_at: "2026-09-24",
  updated_at: "2026-09-24",
  revision: 1,
};
const pdf: Resource = { ...note, id: "pdf", name: "slides.pdf", kind: "pdf" };
let resources: Resource[];
let fail: boolean;
let calls: { url: string; init: RequestInit }[];
beforeEach(() => {
  resources = [note, pdf];
  calls = [];
  fail = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (init.method) calls.push({ url, init });
      if (fail)
        return new Response(
          JSON.stringify({ detail: "Resource request failed" }),
          { status: 500 },
        );
      if (init.method === "DELETE")
        resources = resources.filter(
          (resource) => !url.endsWith(`/${resource.id}`),
        );
      if (init.method === "PATCH")
        resources = resources.map((resource) =>
          url.endsWith(`/${resource.id}`)
            ? {
                ...resource,
                ...JSON.parse(init.body as string),
                revision: resource.revision + 1,
              }
            : resource,
        );
      if (init.method === "POST" && url.endsWith("/note"))
        resources = [
          ...resources,
          { ...note, ...JSON.parse(init.body as string), id: "new" },
        ];
      const query =
        new URL(url, "http://localhost").searchParams.get("q") || "";
      return new Response(
        JSON.stringify(
          resources.filter((resource) =>
            `${resource.name} ${resource.text}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          ),
        ),
      );
    }),
  );
});

it("opens course resources from Courses and searches text using the course endpoint", async () => {
  const user = userEvent.setup();
  render(
    <Courses courses={[course]} loading={false} error="" refresh={vi.fn()} />,
  );
  await user.click(
    screen.getByRole("button", { name: "Resources for Mathematics" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Mathematics resources" }),
  ).toBeVisible();
  await user.type(
    screen.getByRole("searchbox", { name: "Search class resources" }),
    "matrices",
  );
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      "/api/courses/math/resources?q=matrices",
      expect.anything(),
    ),
  );
  expect(
    await screen.findByRole("button", { name: "Exam focus" }),
  ).toBeVisible();
});

it("creates, opens, edits, and deletes a typed note", async () => {
  const user = userEvent.setup();
  render(<ClassResources course={course} onClose={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "New note" }));
  await user.type(screen.getByLabelText("Resource name"), "Week two");
  await user.type(screen.getByLabelText("Note text"), "Determinants");
  await user.click(screen.getByRole("button", { name: "Save note" }));
  expect(calls[0].url).toBe("/api/courses/math/resources/note");
  expect(JSON.parse(calls[0].init.body as string)).toEqual({
    name: "Week two",
    text: "Determinants",
  });
  await user.click(await screen.findByRole("button", { name: "Week two" }));
  expect(screen.getByText("Determinants")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Edit note" }));
  await user.type(screen.getByLabelText("Note text"), " and inverses");
  await user.click(screen.getByRole("button", { name: "Save note" }));
  expect(calls[1].url).toBe("/api/courses/math/resources/new");
  expect(calls[1].init.method).toBe("PATCH");
  expect(JSON.parse(calls[1].init.body as string).text).toBe(
    "Determinants and inverses",
  );
  await user.click(
    await screen.findByRole("button", { name: "Delete Week two" }),
  );
  expect(calls).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Delete resource" }));
  expect(calls[2].init.method).toBe("DELETE");
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Week two" }),
    ).not.toBeInTheDocument(),
  );
});

it("uploads originals as multipart files and offers file links without file editing", async () => {
  const user = userEvent.setup();
  render(<ClassResources course={course} onClose={vi.fn()} />);
  expect(
    await screen.findByRole("link", { name: "Open slides.pdf" }),
  ).toHaveAttribute("href", "/api/courses/math/resources/pdf/file");
  expect(
    screen.queryByRole("button", { name: "Edit slides.pdf" }),
  ).not.toBeInTheDocument();
  const file = new File(["lecture notes"], "reading.md", {
    type: "text/markdown",
  });
  await user.upload(screen.getByLabelText("Upload class resources"), file);
  expect(calls[0].url).toBe("/api/courses/math/resources");
  expect(calls[0].init.method).toBe("POST");
  expect((calls[0].init.body as FormData).get("file")).toBe(file);
  expect(calls[0].init.headers).not.toHaveProperty("Content-Type");
});

it("keeps a note draft after a failed request and prevents accidental closing", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  render(<ClassResources course={course} onClose={close} />);
  await user.click(
    await screen.findByRole("button", { name: "Edit Exam focus" }),
  );
  await user.type(screen.getByLabelText("Note text"), " draft");
  fail = true;
  await user.click(screen.getByRole("button", { name: "Save note" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Resource request failed",
  );
  expect(screen.getByLabelText("Note text")).toHaveValue("Matrices draft");
  vi.spyOn(window, "confirm").mockReturnValue(false);
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(close).not.toHaveBeenCalled();
});

it("retries failed loads and displays extraction errors", async () => {
  fail = true;
  resources = [{ ...pdf, error: "PDF extraction failed", text: "" }];
  const user = userEvent.setup();
  render(<ClassResources course={course} onClose={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Resource request failed",
  );
  fail = false;
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("PDF extraction failed")).toBeVisible();
});

it("uploads code, office, and extensionless originals without filtering", async () => {
  const user = userEvent.setup();
  render(<ClassResources course={course} onClose={vi.fn()} />);
  const files = [
    new File(["print('hello')"], "example.py"),
    new File(["office"], "report.docx"),
    new File(["original"], "README"),
  ];
  await user.upload(screen.getByLabelText("Upload class resources"), files);
  await waitFor(() => expect(calls).toHaveLength(3));
  expect(calls.map(({ init }) => (init.body as FormData).get("file"))).toEqual(
    files,
  );
});

it("shows an uploaded .note as an escaped read-only original", async () => {
  const source = '<script>alert(1)</script><img src=x onerror="alert(1)">';
  resources = [
    {
      ...note,
      name: "fake.note",
      text: source,
      url: "/api/courses/math/resources/note/file",
    },
  ];
  const user = userEvent.setup();
  const view = render(<ClassResources course={course} onClose={vi.fn()} />);
  expect(
    await screen.findByRole("link", { name: "Open fake.note" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Edit fake.note" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "fake.note" }));
  expect(screen.getByText(source)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Edit note" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute(
    "href",
    "/api/courses/math/resources/note/file",
  );
  expect(
    view.baseElement.querySelector("script, img, iframe, textarea"),
  ).toBeNull();
});
