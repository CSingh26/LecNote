# Recover a retained recording

If the recorder says **Recording retained** with pending chunks, some audio may
exist only in the open browser tab. Do not refresh, navigate away, close the tab,
switch its frontend code, or clear browser storage.

1. Click **Download recording (WAV)** in the existing tab. Complete the browser's
   save dialog, then confirm the download completed and its duration matches the
   lecture. Keep this independent backup until server playback is verified.
2. Check the existing backend, normally `http://127.0.0.1:8765/api/health`.
   Confirm it is the original library and still contains the recording's lecture
   ID. Do not start a replacement server with an empty database or start another
   worker against a library already in use.
3. If only the Vite frontend on port 5173 has stopped, use the recovery bridge
   below. **Do not restart Vite while audio is retained.** Its reconnect behavior
   can reload the page and discard in-memory audio.

From the repository root, with Node.js installed:

```sh
node scripts/recover-frontend.mjs --port 5173 --upstream http://127.0.0.1:8765
```

Choose the port of the existing tab, not a new one. The bridge binds only to
IPv4 loopback, accepts local host names, and requires a loopback HTTP backend.
It streams `/api/` requests to that backend and refuses WebSocket upgrades so
Vite's reload ping cannot succeed. It does not serve frontend files. An occupied
port causes it to exit without terminating or replacing the existing process.
An unavailable backend returns an error without accepting the upload as saved.
This is a recovery tool, not a replacement frontend or a persistent service.

4. Leave that terminal running. In the **original tab**, click **Retry uploads &
   finish**. Confirm **Saved** and **0 pending**. A queued transcription job is
   separate from upload completion; allow local processing to finish.
5. Verify the lecture and playback through the backend-served UI at
   `http://127.0.0.1:8765`. Keep the downloaded WAV. Once recovery is confirmed,
   use that backend-served UI for subsequent recordings and stop only the
   recovery bridge with Ctrl-C. Existing backend and other servers stay running.

If the backend itself is unavailable, the bridge cannot repair it. Preserve the
tab and WAV while restoring the **same** backend and library. If the tab has
already been lost, import the downloaded WAV into the correct class; do not
delete the partial server recording until the replacement is verified.

## Branches and library data

`main` contains application code, not recordings or the SQLite database. A
frontend from another branch can continue using the same local backend. The
backend's configured data directory or container volume determines the library.
Do not commit that directory, `.env` files, settings, or credentials.

Before changing a backend installation, back up its complete data directory.
Use SQLite's online backup API for a database snapshot, rather than copying a
live database file. Copy and verify all referenced media and attachments too;
files may still be changing while processing is active. For a portable,
verified offline copy with relocated file paths, use the
[library migration guide](container-migration.md) after recording and jobs have
finished. Container records may contain `/data/...` paths and must not be opened
as a host library without path relocation.

When comparing two libraries, check record IDs, saved content, attachments, and
audio files before any write. If the current library already includes every old
record and file, retain it; importing the old database over it would roll back
newer recordings. Keep both backups even when no merge is needed.

## Recovery bridge regression test

```sh
node --test tests/recovery-proxy.test.mjs
```

The tests use isolated ephemeral ports and never connect to the user's library.
