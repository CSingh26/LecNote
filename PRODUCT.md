# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

LecNote is a single-user, laptop-first lecture and study workspace, also usable
from narrow browser viewports. Its user records or imports lectures, organizes
them by course, and studies the resulting notes with access to the original
transcript, audio, and supporting materials.

## Product Purpose

Turn lectures into useful, source-grounded study material while preserving the
original recordings, user corrections, and personal notes. The current redesign
covers the whole app, not one preferred task. The user specifically identified
crowded controls, navigation, finding materials, lack of animation, and lack of
personality as the problems to solve.

## Positioning

Audio transcription runs locally. Generated notes connect to timestamped source
speech and explicitly selected course context. Course resources, lecture
attachments, preparation, relevance review, and notes belong to the same local
study workflow rather than disconnected upload and reading tools.

## Operating Context

- Library and courses organize imported transcripts, uploaded recordings, and
  live recordings from the microphone or shared lecture audio.
- Recording supports pause/resume and navigation without discarding capture.
- Preparation combines a recording note and selected readable course resources.
- Local transcription is separate from explicit paid note generation.
- A lecture contains notes, transcript, relevance, materials, and review views,
  with playback, personal annotations, and exports.
- Search, background jobs, settings, and error/retry states remain essential.

## Capabilities and Constraints

- Preserve existing recording, import, merge, materials, note generation,
  transcript editing, review, export, and recovery behavior.
- Preserve local storage and privacy boundaries. Never seed invented lectures
  into a real library or expose saved credentials.
- Do not start paid AI generation or microphone/sharing capture without the
  existing explicit user actions.
- Do not stop, restart, or modify existing running servers or active libraries.
  Development and verification use a separate checkout, ports, and test data.
- The implementation is React/TypeScript/Vite with a FastAPI backend. This is a
  frontend redesign, not a request to replace the backend or inference engine.
- Commit and push verified milestones to the configured GitHub remote. A new
  main-branch merge, version tag, or published release is a separate decision.

## Brand Commitments

Keep the name LecNote and the product's lecture-study purpose. The current
**Academic Field Guide** direction is a calm, approachable study journal:
paper, ink, honey, and sage; expressive serif headings with clean sans-serif
labels; a small bee; simple rows; and restrained borders and shadows.
Accessibility, honest feedback, and light/dark themes are part of the identity.
Use the locally bundled Newsreader font for headings and a system sans-serif
stack for labels and body text. Keep courses, the lecture index, notes, and
source materials easy to navigate, with purposeful motion that respects reduced
motion. Real library content and accurate task states supply the substance.
This direction supersedes Course Editions and its approved comp, which remain
historical records of v1.1.0. Academic Field Guide is currently an unreleased
milestone on `codex/academic-field-guide`, pending integration; it is not a
newly deployed or published release.

## Evidence on Hand

The repository contains implemented flows, unit tests, browser tests, synthetic
lecture fixtures, and verified v1.0.2 release notes. Previous screenshots in the
release worktree show the incumbent interface. They are visual evidence, not an
approved direction for this redesign. Test content must remain clearly separate
from real user data. There are no supplied testimonials or commercial claims.

## Product Principles

1. Give every existing workflow a clear place; do not improve one by hiding another.
2. Show contextually relevant actions instead of presenting every control at once.
3. Make it easy to find a course's resources and a lecture's own attachments.
4. Add personality and purposeful motion without delaying repeated study tasks.
5. Preserve source material, corrections, and recoverable work across all states.

## Accessibility & Inclusion

Preserve keyboard navigation, labeled controls, focus visibility, readable
contrast, and responsive layouts. New motion must respect reduced-motion
preferences and never be required to understand an action or state.
