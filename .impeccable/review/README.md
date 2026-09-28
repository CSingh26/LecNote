# Redesign review evidence

Captured on 2026-09-28 by `web/tests/redesign.spec.ts` (Chromium, isolated Vite
server on port 4175) from the synthetic fixtures in
`web/tests/fixtures/demo-library.ts`. No real library was read or written.

| File | Route | Viewport |
| --- | --- | --- |
| reader-1440.png, reader-1280.png | `#/lecture/energy` (index + notes + materials) | 1440, 1280 |
| reader-390.png, reader-320.png | long-title lecture, full-width reader | 390, 320 |
| reader-materials-390.png | narrow materials disclosure | 390 |
| library-1440-screen.png, library-390.png | library, all courses / Physics | 1440, 390 |
| materials-1280.png | Materials with source preview (12 courses) | 1280 |
| drawer-390.png | course drawer | 390 |
| courses-1440-screen.png, settings-1440-screen.png, record-390-screen.png | remaining screens | 1440, 390 |

Review rounds: one batched capture of every route at desktop and mobile, one
fix batch (index column sizing, materials header, narrow title collapse,
nav clipping, processing bar alignment), and one confirmation round.

Not performed: the Impeccable `comp-spec`/`font-match` measurement gates, the
mechanical detector, the shipped finish reviewer, and the shipped documenter
were not available in this environment. Measurements came from the approved
comp and its generation record; DESIGN.md and design.json were written by hand
from the shipped stylesheet. An independent finish review is still outstanding.
