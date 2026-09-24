import { createRoot } from "react-dom/client";
import { Library } from "../../src/pages/Library";
import { Settings } from "../../src/pages/Settings";
import { RelevanceView } from "../../src/components/RelevanceView";
import { StorageStatus } from "../../src/components/StorageStatus";
import { recording } from "../../src/components/Milestone5.fixtures";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const lecture = {
  ...recording,
  transcript: {
    language: "en",
    duration: 60,
    segments: [
      {
        id: 0,
        start: 0,
        end: 15,
        text: "Kinetic energy depends on mass and the square of velocity.",
        speaker: null,
      },
      {
        id: 1,
        start: 15,
        end: 30,
        text: "The next exam covers conservation of energy and momentum.",
        speaker: null,
      },
      {
        id: 2,
        start: 30,
        end: 45,
        text: "An uncertain example with a deliberately long word: conservationofangularmomentuminrotatingsystems.",
        speaker: null,
      },
    ],
  },
  relevance: {
    topic_map: {
      summary: "Energy, momentum, and the course exam.",
      topics: ["Kinetic energy", "Conservation of momentum"],
    },
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
        reason: "Exam scope",
      },
    ],
  },
  relevance_overrides: { "1": "class_logistics" },
  finalized_at: "2026-09-24T00:00:00Z",
  compression: {
    status: "compressed",
    original_bytes: 104857600,
    compressed_bytes: 26214400,
    saved_bytes: 78643200,
  },
};
createRoot(document.getElementById("root")!).render(
  <main style={{ maxWidth: 1150, margin: "0 auto", padding: 20 }}>
    {params.get("view") === "relevance" ? (
      <>
        <h1>Energy and momentum</h1>
        <StorageStatus lecture={lecture} />
        <RelevanceView
          lecture={lecture}
          onSaved={() => {}}
          onSeek={(seconds) => {
            document.documentElement.dataset.seek = String(seconds);
          }}
        />
      </>
    ) : params.get("view") === "settings" ? (
      <Settings
        error=""
        refresh={() => {}}
        onSaved={() => {}}
        settings={{
          model: "gpt-5.4-mini",
          whisper_model: "base",
          chunk_minutes: 8,
          parallel_requests: 2,
          language: "en",
          diarization: false,
          api_key_configured: false,
          hf_token_configured: false,
          input_price_per_million: 0,
          output_price_per_million: 0,
          capabilities: {
            whisper: true,
            ffmpeg: true,
            ocr: false,
            diarization: false,
          },
        }}
      />
    ) : (
      <Library courses={[]} version={0} onNew={() => {}} />
    )}
  </main>,
);
