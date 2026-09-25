import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Materials } from "./Materials";
import type { Attachment, Lecture } from "../types";

const lecture: Lecture = {
  id: "lecture",
  title: "Files",
  course_id: null,
  source_name: "",
  media_type: "",
  status: "ready",
  duration: 0,
  created_at: "2026-09-24",
  updated_at: "2026-09-24",
  context: "",
  language: "en",
  transcript: null,
  notes: null,
  user_notes: "",
  attachments: [],
  error: null,
  job: null,
};
const attachment: Attachment = {
  id: "file",
  name: "script.js",
  kind: "js",
  text: "<script>alert(1)</script>",
  url: "/api/lectures/lecture/attachments/file",
  created_at: "2026-09-24",
  error: null,
};
let uploaded: File[];
beforeEach(() => {
  uploaded = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      uploaded.push((init.body as FormData).get("file") as File);
      return new Response(JSON.stringify(attachment));
    }),
  );
});

it("uploads arbitrary file types from the materials picker", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  render(<Materials lecture={lecture} onSaved={onSaved} />);
  const files = [
    new File(["print('hello')"], "example.py"),
    new File(["office"], "report.docx"),
    new File(["original"], "README"),
    new File(["<svg />"], "image.svg", { type: "image/svg+xml" }),
  ];
  await user.upload(screen.getByLabelText("Upload source materials"), files);
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(uploaded).toEqual(files);
});

it.each(["renamed.png", "renamed.pdf", "script.js", "page.html", "image.svg"])(
  "keeps active content read-only and escaped even when named %s",
  async (name) => {
    const user = userEvent.setup();
    const view = render(
      <Materials
        lecture={{ ...lecture, attachments: [{ ...attachment, name }] }}
        onSaved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: `View ${name}` }));
    expect(screen.getAllByText(attachment.text)[0]).toBeVisible();
    expect(
      view.baseElement.querySelector("script, img, iframe, textarea"),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute(
      "href",
      attachment.url,
    );
  },
);

it.each(["png", "pdf"])(
  "previews stored %s kind regardless of display filename",
  async (kind) => {
    const user = userEvent.setup();
    const view = render(
      <Materials
        lecture={{
          ...lecture,
          attachments: [{ ...attachment, name: "renamed.html", kind }],
        }}
        onSaved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "View renamed.html" }));
    const preview = view.baseElement.querySelector(
      kind === "png" ? ".preview-body img" : "iframe",
    );
    expect(preview).toHaveAttribute("src", attachment.url);
    if (kind === "pdf") expect(preview).toHaveAttribute("sandbox", "");
  },
);

it("retains the extraction warning and original link for download-only files", async () => {
  const user = userEvent.setup();
  render(
    <Materials
      lecture={{
        ...lecture,
        attachments: [
          {
            ...attachment,
            name: "data.bin",
            kind: "bin",
            text: "",
            error: "Download only",
          },
        ],
      }}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByText("Download only")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "View data.bin" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Download only");
  expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute(
    "href",
    attachment.url,
  );
});
