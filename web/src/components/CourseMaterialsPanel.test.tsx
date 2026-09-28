import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { CourseMaterialsPanel } from "./CourseMaterialsPanel";
import type { Course, Resource } from "../types";

const physics: Course = {
  id: "phy101",
  name: "Physics",
  code: "PHY101",
  color: "#f1de54",
  context: "",
  vocabulary: "",
  created_at: "2026-09-24",
  lecture_count: 4,
};
const accounting: Course = {
  ...physics,
  id: "acc502",
  name: "Accounting",
  code: "ACC502",
};
const energy: Resource = {
  id: "source-1",
  course_id: "phy101",
  name: "Energy reference.pdf",
  kind: "pdf",
  text: "Kinetic energy depends on mass and speed.",
  url: "/api/courses/phy101/resources/source-1/file",
  created_at: "2026-09-24",
  updated_at: "2026-09-24",
  revision: 1,
};
const ledger: Resource = {
  ...energy,
  id: "source-2",
  course_id: "acc502",
  name: "Accounting notes.md",
  kind: "md",
  text: "# Ledgers",
  url: "/api/courses/acc502/resources/source-2/file",
};
let resources: Record<string, Resource[]>;
let fail: boolean;
let requests: string[];
beforeEach(() => {
  resources = { phy101: [energy], acc502: [ledger] };
  fail = false;
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requests.push(url);
      if (fail)
        return new Response(JSON.stringify({ detail: "Materials failed" }), {
          status: 500,
        });
      const course = /\/courses\/([^/]+)\/resources/.exec(url)?.[1] || "";
      const query = new URL(url, "http://localhost").searchParams.get("q");
      return new Response(
        JSON.stringify(
          (resources[decodeURIComponent(course)] || []).filter(
            (resource) =>
              !query ||
              `${resource.name} ${resource.text}`
                .toLowerCase()
                .includes(query.toLowerCase()),
          ),
        ),
      );
    }),
  );
});

it("shows only the selected course resources", async () => {
  const user = userEvent.setup();
  render(<CourseMaterialsPanel course={physics} />);
  expect(await screen.findByText("Energy reference.pdf")).toBeVisible();
  expect(screen.queryByText("Accounting notes.md")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Preview Energy reference.pdf" }),
  );
  expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute(
    "href",
    "/api/courses/phy101/resources/source-1/file",
  );
  expect(
    screen.getByText("Kinetic energy depends on mass and speed."),
  ).toBeVisible();
});

it("filters resources with the course search", async () => {
  resources.phy101 = [
    energy,
    { ...energy, id: "source-3", name: "Lecture slides.pdf", text: "Forces" },
  ];
  const user = userEvent.setup();
  render(<CourseMaterialsPanel course={physics} />);
  await screen.findByText("Lecture slides.pdf");
  await user.type(
    screen.getByRole("searchbox", { name: "Search Physics materials" }),
    "forces",
  );
  await waitFor(() =>
    expect(requests).toContain("/api/courses/phy101/resources?q=forces"),
  );
  await waitFor(() =>
    expect(screen.queryByText("Energy reference.pdf")).not.toBeInTheDocument(),
  );
});

it("clears source preview when course changes", async () => {
  const user = userEvent.setup();
  const view = render(<CourseMaterialsPanel course={physics} />);
  await user.click(
    await screen.findByRole("button", {
      name: "Preview Energy reference.pdf",
    }),
  );
  expect(
    screen.getByRole("heading", { name: "Energy reference.pdf" }),
  ).toBeVisible();
  view.rerender(<CourseMaterialsPanel course={accounting} />);
  expect(await screen.findByText("Accounting notes.md")).toBeVisible();
  expect(screen.queryByText("Energy reference.pdf")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Energy reference.pdf" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open original" })).toBeNull();
});

it("renders Markdown resources safely without raw HTML", async () => {
  resources.phy101 = [
    {
      ...energy,
      name: "Worked examples.md",
      kind: "md",
      text: "## Kinetic energy\n\n<img src=x onerror=alert(1)><script>x</script>",
    },
  ];
  const user = userEvent.setup();
  const view = render(<CourseMaterialsPanel course={physics} />);
  await user.click(
    await screen.findByRole("button", { name: "Preview Worked examples.md" }),
  );
  expect(screen.getByRole("heading", { name: "Kinetic energy" })).toBeVisible();
  expect(view.container.querySelector("script, img")).toBeNull();
});

it("shows resource errors with retry", async () => {
  fail = true;
  const user = userEvent.setup();
  render(<CourseMaterialsPanel course={physics} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Materials failed",
  );
  fail = false;
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Energy reference.pdf")).toBeVisible();
});

it("opens existing management and refreshes on close", async () => {
  const user = userEvent.setup();
  render(<CourseMaterialsPanel course={physics} />);
  await screen.findByText("Energy reference.pdf");
  await user.click(screen.getByRole("button", { name: "Manage materials" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Physics resources",
  });
  expect(within(dialog).getByRole("button", { name: "Upload" })).toBeVisible();
  resources.phy101 = [
    energy,
    { ...energy, id: "source-4", name: "Work and power.pdf" },
  ];
  await user.click(
    within(dialog).getByRole("button", { name: "Close dialog" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(await screen.findByText("Work and power.pdf")).toBeVisible();
});
