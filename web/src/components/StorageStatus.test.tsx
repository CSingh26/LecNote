import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { StorageStatus } from "./StorageStatus";
import { recording } from "./Milestone5.fixtures";

it("shows saved storage and ignores absent or unfinished recordings", () => {
  const view = render(<StorageStatus lecture={recording} />);
  expect(view.container).toBeEmptyDOMElement();
  view.rerender(
    <StorageStatus
      lecture={{
        ...recording,
        finalized_at: "2026-09-24T00:00:00Z",
        compression: {
          status: "completed",
          original_bytes: 104857600,
          compressed_bytes: 26214400,
          saved_bytes: 78643200,
        },
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("75 MiB saved");
  expect(screen.getByRole("status")).toHaveTextContent("25 MiB");
});

it("shows compression failures and retry timing without offering an action", () => {
  render(
    <StorageStatus
      lecture={{
        ...recording,
        finalized_at: "2026-09-24T00:00:00Z",
        compression: {
          status: "failed",
          error: "Encoder unavailable",
          next_attempt_at: "2026-09-25T01:00:00Z",
        },
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Encoder unavailable");
  expect(screen.getByRole("status")).toHaveTextContent(/retry/i);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it.each([
  ["not_smaller", "Original retained: already compact"],
  ["video", "Video retained"],
  ["pending", "Compression pending"],
])("renders service status %s", (status, label) => {
  render(
    <StorageStatus
      lecture={{
        ...recording,
        finalized_at: "2026-09-24T00:00:00Z",
        compression: { status, eligible_at: "2026-09-24T06:00:00Z" },
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(label);
  if (status === "pending")
    expect(screen.getByRole("status")).toHaveTextContent("Eligible");
});
