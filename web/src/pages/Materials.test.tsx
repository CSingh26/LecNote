import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { MaterialsPage } from "./Materials";
import type { Course, Resource } from "../types";

const course = (id: string, code: string, name: string): Course => ({
  id,
  name,
  code,
  color: "#f1de54",
  context: "",
  vocabulary: "",
  created_at: "2026-09-24",
  lecture_count: 1,
});
const courses = [
  course("phy101", "PHY101", "Physics"),
  course("acc502", "ACC502", "Accounting"),
  course("math201", "MATH201", "Calculus"),
];
const energy: Resource = {
  id: "source-1",
  course_id: "phy101",
  name: "Energy reference.pdf",
  kind: "pdf",
  text: "Kinetic energy",
  created_at: "2026-09-24",
  updated_at: "2026-09-24",
  revision: 1,
};
let requests: string[];
beforeEach(() => {
  requests = [];
  window.location.hash = "#/materials";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requests.push(url);
      return new Response(
        JSON.stringify(url.startsWith("/api/courses/phy101") ? [energy] : []),
      );
    }),
  );
});

it("does not fetch every course in the unselected state", async () => {
  render(<MaterialsPage courses={courses} />);
  expect(
    screen.getByRole("heading", { name: "Materials" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Physics/ })).toHaveAttribute(
    "href",
    "#/materials?course=phy101",
  );
  expect(screen.getByRole("link", { name: /Calculus/ })).toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(requests.filter((url) => url.includes("/resources"))).toHaveLength(0);
});

it("loads one course from the explicit course selector", async () => {
  const onCourseChange = vi.fn();
  const user = userEvent.setup();
  render(<MaterialsPage courses={courses} onCourseChange={onCourseChange} />);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Course" }),
    "phy101",
  );
  expect(onCourseChange).toHaveBeenCalledWith("phy101");
  expect(await screen.findByText("Energy reference.pdf")).toBeVisible();
  await waitFor(() =>
    expect(
      requests
        .filter((url) => url.includes("/resources"))
        .every((url) => url.startsWith("/api/courses/phy101/resources")),
    ).toBe(true),
  );
});

it("opens directly on a linked course", async () => {
  render(<MaterialsPage courses={courses} initialCourse="phy101" />);
  expect(
    screen.getByRole("heading", { name: "Physics materials" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("Energy reference.pdf")).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Course" })).toHaveValue(
    "phy101",
  );
});
