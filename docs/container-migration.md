# Move an existing library into a container

Back up the complete library, not just `library.sqlite3`: recordings, attachment
originals, generated notes, transcripts, and settings also live on disk. Settings
may contain API credentials. Keep the library, backups, and verification receipts
private and outside Git and Docker build contexts.

## Safe switchover

1. Finish recordings and processing, close editing tabs, then stop the old server.
   Do not let two app instances write to the same library.
2. Make a verified offline backup into a new directory:

   ```sh
   python -m lecnote.migrate_library /absolute/original/data /absolute/backup/data --report /absolute/backup/receipt.json
   ```

3. Make a separate working copy from that backup. Database file locations are
   converted to the container's `/data` mount; notes and transcript text are not
   rewritten:

   ```sh
   python -m lecnote.migrate_library /absolute/backup/data /absolute/container/data --path-root /absolute/original/data --target-root /data --report /absolute/container/receipt.json
   ```

The migration refuses active workers, active recording/processing records,
existing destinations, symbolic links, missing referenced files, and files outside
the source library. It uses SQLite's backup API to include WAL data, verifies
database integrity and records, and compares SHA-256 checksums for every copied
non-database file. Failed verification never publishes the destination directory.
Receipts contain counts and checksums, not file contents or credentials.

4. Build the current source for your computer's native architecture, then start
   it on a temporary port with only the working copy mounted. On macOS/Linux,
   matching your user ID keeps a private bind-mounted library writable:

   ```sh
   docker build -t lecnote:local .
   docker run -d --name lecnote-check --init --user "$(id -u):$(id -g)" -p 127.0.0.1:8872:8765 --mount type=bind,src=/absolute/container/data,dst=/data lecnote:local python -c 'import uvicorn; from lecnote.api import create_app; uvicorn.run(create_app(start_worker=False), host="0.0.0.0", port=8765)'
   ```

   This verification instance has no background worker, so automatic compression
   and queued processing cannot run. Do not record, edit, or submit jobs on it.

5. Verify classes, lecture IDs, saved notes/transcripts, original file downloads,
   audio playback, and settings. Do not run paid generation as a migration test.
   Stop and remove only this temporary container (not its data directory), then
   run the same image and mount at the usual port:

   ```sh
   docker stop lecnote-check
   docker rm lecnote-check
   docker run -d --name lecnote --init --restart unless-stopped --user "$(id -u):$(id -g)" -p 127.0.0.1:8765:8765 --mount type=bind,src=/absolute/container/data,dst=/data lecnote:local
   ```

Docker Desktop must be running. Stop/start and container replacement do not remove
bind-mounted data. Back up the new working library regularly. New Whisper weights
download into `/data/models` on first use; direct-install model caches may live
outside the old library and are not implicitly migrated.

## Rollback

Stop the container before restarting the unchanged original app with its original
data directory. Keep the original checkout until the migration is accepted.
Changes made after the container switchover exist only in the new working library;
back that up before any rollback rather than overwriting it with the old backup.
Do not point the old app at the container copy because its stored paths use `/data`.

## Material uploads

Class resources and lecture materials accept any file extension, including code
and extensionless files, up to 30 MiB per file. Supported readable documents and
text contribute context; binary or unsupported formats remain downloadable with
an extraction notice. Storing a file is not a promise that its contents can be
interpreted. Uploaded code, scripts, and macros are never executed. Arbitrary
files are served as downloads rather than active web pages.
