export interface Course {
  id: string;
  name: string;
  code: string;
  color: string;
  context: string;
  vocabulary: string;
  created_at: string;
  lecture_count: number;
}
export interface Segment {
  id: number;
  start: number;
  end: number;
  text: string;
  speaker: string | null;
}
export interface Transcript {
  language: string;
  duration: number;
  segments: Segment[];
}
export interface Job {
  id: string;
  lecture_id: string;
  status: string;
  stage: string;
  progress: number;
  message: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}
export interface Attachment {
  id: string;
  name: string;
  kind: string;
  text: string;
  url: string;
  created_at: string;
  error: string | null;
}
export interface Definition {
  term: string;
  definition: string;
}
export interface Question {
  question: string;
  answer: string;
}
export interface Visual {
  kind: "mermaid" | "plot";
  title: string;
  mermaid: string | null;
  x: number[];
  y: number[];
  x_label: string;
  y_label: string;
  image: string | null;
}
export interface ChunkNote {
  index: number;
  start: number;
  end: number;
  title: string;
  summary: string;
  key_points: { text: string; timestamp: number }[];
  definitions: Definition[];
  formulas: { latex: string; explanation: string }[];
  examples: string[];
  emphasized_points: string[];
  practice: Question[];
  visual: Visual | null;
}
export interface Notes {
  title: string;
  overview: string;
  takeaways: string[];
  glossary: Definition[];
  review_questions: Question[];
  chunks: ChunkNote[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}
export interface Lecture {
  id: string;
  course_id: string | null;
  title: string;
  source_name: string;
  media_type: string;
  status: string;
  duration: number;
  created_at: string;
  updated_at: string;
  context: string;
  language: string;
  transcript: Transcript | null;
  notes: Notes | null;
  notes_stale?: boolean;
  user_notes: string;
  attachments: Attachment[];
  error: string | null;
  job: Job | null;
  course_name?: string;
  course_code?: string;
  course_color?: string;
}
export interface Settings {
  model: string;
  whisper_model: string;
  chunk_minutes: number;
  parallel_requests: number;
  language: string;
  diarization: boolean;
  api_key_configured: boolean;
  hf_token_configured: boolean;
  input_price_per_million: number;
  output_price_per_million: number;
  capabilities: {
    whisper: boolean;
    ffmpeg: boolean;
    ocr: boolean;
    diarization: boolean;
  };
}
export interface SearchResult {
  lecture_id: string;
  title: string;
  course_name: string;
  snippet: string;
  timestamp: number | null;
  kind: string;
}
export interface GlossaryEntry extends Definition {
  lecture_id: string;
  lecture_title: string;
}
export type RecordingDraft = {
  title: string;
  course_id: string;
  context: string;
  language: string;
};
