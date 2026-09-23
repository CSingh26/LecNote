# Shared contracts

All endpoints use `/api`; JSON unless specified. Errors are `{detail: string}`.
IDs are UUID strings, times ISO UTC strings, durations seconds, progress 0..100.

## Data

Course: `{id,name,code,color,context,vocabulary,created_at,lecture_count}`.
Lecture: `{id,course_id,title,source_name,media_type,status,duration,created_at,
updated_at,context,language,transcript,notes,user_notes,attachments,error,job}`.
List responses may omit transcript/notes/attachments but include course_name,
course_code, course_color and counts. Status: draft/queued/transcribing/
generating/ready/failed/cancelled/recording/interrupted.
Segment: `{id:int,start:float,end:float,text:string,speaker:string|null}`.
Transcript: `{language:string,duration:float,segments:Segment[]}`.
Job: `{id,lecture_id,status,stage,progress,message,error,created_at,updated_at}`.
Job statuses queued/running/completed/failed/cancelled/interrupted.
Attachment: `{id,name,kind,text,url,created_at,error}`.

Notes: `{title,overview,takeaways:string[],glossary:Definition[],
review_questions:Question[],chunks:ChunkNote[],usage:{input_tokens,output_tokens},
model:string}`.
Definition: `{term,definition}`. Question: `{question,answer}`.
ChunkNote: `{index,start,end,title,summary,key_points:Point[],definitions:Definition[],
formulas:Formula[],examples:string[],emphasized_points:string[],
practice:Question[],visual:Visual|null}`.
Point: `{text,timestamp:float}`. Formula: `{latex,explanation}`.
Visual: `{kind:'mermaid'|'plot',title,mermaid:string|null,x:number[],y:number[],
x_label:string,y_label:string,image:string|null}`.

## Endpoints

- GET `/health` -> `{status:'ok'}`.
- GET `/courses` -> Course[]; POST `/courses` body `{name,code?,color?,context?,vocabulary?}` -> Course.
- PATCH `/courses/{id}` partial fields; DELETE only empty courses -> 204.
- GET `/lectures?course_id=&q=` -> Lecture[].
- POST `/lectures` multipart `file`, `title`, optional `course_id`, `context`,
  `language`, `process` ('true' default) -> Lecture. Supports wav/mp3/m4a/mp4/
  webm/ogg/flac/mov/aac. Returns queued job or draft.
- POST `/lectures/import` JSON `{title,course_id?,context?,transcript:Transcript}` -> Lecture draft.
- GET/PATCH/DELETE `/lectures/{id}`. PATCH `{title?,course_id?,context?,user_notes?}`.
  Actual title/course/context changes preserve notes and set `notes_stale:true`
  when notes exist. Unchanged fields do not invalidate notes. Course-context and
  material changes follow the same preservation policy.
- PUT `/lectures/{id}/transcript` Transcript -> Lecture, rejects active jobs;
  marks saved notes stale on changes, preserves notes and user_notes.
- POST `/lectures/{id}/process` JSON `{force?:bool,diarize?:bool,transcribe_only?:bool}` -> Job.
  Omitted diarize inherits the setting. Transcription-only preserves existing notes,
  marking them stale if the transcript changes, or completes as a draft if no notes exist. Successful note generation
  replaces notes and clears `notes_stale`. Failures keep the previous notes.
  On startup, valid saved `notes.json` files repair missing database notes; recovered
  notes are marked stale and never overwrite an existing database copy.
- POST `/lectures/{id}/cancel` -> Job.
- GET `/lectures/{id}/media` -> range-enabled original media or finalized WAV.
- GET `/lectures/{id}/notes` -> Notes or 404.
- PUT `/lectures/{id}/notes` body `{user_notes:string}` -> Lecture.
- POST `/lectures/{id}/attachments` multipart `file` -> Attachment.
- GET `/lectures/{id}/attachments/{attachment_id}` -> file.
- DELETE `/lectures/{id}/attachments/{attachment_id}` -> 204.
- GET `/lectures/{id}/assets/{filename}` -> generated image.
- GET `/lectures/{id}/export/{format}` format md/html/pdf/json -> download.
- GET `/jobs` -> Job[] (recent 100).
- GET `/search?q=&course_id=` -> `[{lecture_id,title,course_name,snippet,timestamp,kind}]`.
- GET `/glossary?course_id=` -> `[{term,definition,lecture_id,lecture_title}]`.
- GET `/settings` -> `{model,whisper_model,chunk_minutes,parallel_requests,language,
  diarization,api_key_configured,hf_token_configured,input_price_per_million,
  output_price_per_million,capabilities:{whisper,ffmpeg,ocr,diarization}}`.
- PUT `/settings` same configurable fields plus optional `api_key` and `hf_token`;
  omit secrets to retain; empty string clears saved secret. Never returns secrets.
- POST `/settings/check` -> `{ok:bool,message:string}` (local configuration only).
- POST `/live` JSON `{title,course_id?,language?,context?}` -> `{id,lecture_id}` (same IDs).
  Audio sources are mixed locally in the browser; video is not uploaded.
- POST `/live/{id}/chunks` multipart `file` independent mono PCM16 WAV,
  `sequence` nonnegative integer, `offset` seconds -> `{accepted:true}`.
  Queue local transcription without blocking request. GET lecture includes segments.
- POST `/live/{id}/finish` -> Lecture; combines WAV chunks in sequence order,
  queues full pipeline after outstanding live chunks finish. Without a configured
  OpenAI key, saves local transcription only; notes can be generated later.

## Python boundaries

Settings is in `lecnote.config`; dataclass-like attributes:
`data_dir:Path`, `model:str` (default gpt-4.1-mini), `api_key:str`,
`whisper_model:str` (base), `chunk_minutes:float` (8), `parallel_requests:int` (4),
`language:str` (empty=auto), `diarization:bool`, `hf_token:str`,
`input_price_per_million:float`, `output_price_per_million:float` (zero=unset).
`settings.lecture_dir(id)` returns data_dir/lectures/id.

`run_pipeline(lecture:dict, settings:Settings, progress:Callable[[str,float,str],None],
is_cancelled:Callable[[],bool]) -> dict` in pipeline.py.
Lecture input includes `id,title,context,course_context,vocabulary,media_path`,
`transcript` (dict|null), `attachments` with extracted `text`, and `diarize`.
Return `{transcript:dict,notes:dict}`. Raise `PipelineCancelled` for cancel.
Persist transcript.json and each notes chunk atomically under lecture_dir.
`transcribe(path:Path,settings:Settings,vocabulary:str='',progress=None)->dict`
in transcription.py. No upload/transcription API usage.
`export_notes(lecture:dict,format:str,output_dir:Path)->Path` in exports.py.
It uses lecture['notes'], ['transcript'], ['user_notes']; ensure assets accessible.

`extract_context(path:Path)->str` in enrichment.py; raises actionable RuntimeError
when local OCR unavailable. Supports .txt/.md/.pdf/.png/.jpg/.jpeg/.webp.
`diarize_segments(path:Path,segments:list[dict],token:str)->list[dict]` local only.
`assemble_wav(chunks:list[Path],destination:Path)->None` strict matching sample format.
`capabilities()->dict` -> `{'ocr':bool,'diarization':bool}` local availability.
