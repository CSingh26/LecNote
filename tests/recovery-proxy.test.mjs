import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";
import test from "node:test";

test(
  "recovery proxy forwards uploads without accepting reload WebSockets",
  { timeout: 10000 },
  async (t) => {
    const upstream = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          path: req.url,
          method: req.method,
          body: Buffer.concat(chunks).toString("base64"),
          origin: req.headers.origin,
          host: req.headers.host,
          contentType: req.headers["content-type"],
        }),
      );
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    t.after(() => new Promise((resolve) => upstream.close(resolve)));
    const child = spawn(process.execPath, [
      "scripts/recover-frontend.mjs",
      "--port",
      "0",
      "--upstream",
      `http://127.0.0.1:${upstream.address().port}`,
    ]);
    t.after(() => child.kill());
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const address = await Promise.race([
      once(child.stdout, "data").then(
        ([data]) => JSON.parse(data.toString()).url,
      ),
      once(child, "exit").then(() => null),
    ]);
    assert.ok(address, `Recovery service must start: ${stderr}`);
    const audio = Buffer.alloc(2 * 1024 * 1024);
    for (let index = 0; index < audio.length; index++)
      audio[index] = index % 256;
    const response = await fetch(
      `${address}/api/live/session/chunks?sequence=118`,
      {
        method: "POST",
        body: Readable.from([audio.subarray(0, 1024), audio.subarray(1024)]),
        duplex: "half",
        headers: {
          origin: "http://localhost:5173",
          "content-type": "application/octet-stream",
        },
      },
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      path: "/api/live/session/chunks?sequence=118",
      method: "POST",
      body: audio.toString("base64"),
      origin: "http://localhost:5173",
      host: new URL(address).host,
      contentType: "application/octet-stream",
    });
    assert.equal((await fetch(address)).status, 503);
    const untrustedStatus = await new Promise((resolve, reject) => {
      http
        .get(
          `${address}/api/health`,
          { headers: { host: "untrusted.example" } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        )
        .on("error", reject);
    });
    assert.equal(untrustedStatus, 403);
    const socket = net.connect(new URL(address).port, "127.0.0.1");
    t.after(() => socket.destroy());
    await once(socket, "connect");
    let upgrade = "";
    socket.on("data", (chunk) => {
      upgrade += chunk;
    });
    socket.write(
      "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Protocol: vite-ping\r\n\r\n",
    );
    await once(socket, "close");
    assert.doesNotMatch(upgrade, /101 Switching Protocols/);
    await new Promise((resolve) => upstream.close(resolve));
    assert.equal((await fetch(`${address}/api/health`)).status, 502);
  },
);

test(
  "recovery proxy refuses an occupied port without replacing its server",
  { timeout: 10000 },
  async (t) => {
    const existing = http.createServer((_req, res) =>
      res.end("original server"),
    );
    existing.listen(0, "127.0.0.1");
    await once(existing, "listening");
    t.after(() => new Promise((resolve) => existing.close(resolve)));
    const port = existing.address().port;
    const child = spawnSync(
      process.execPath,
      ["scripts/recover-frontend.mjs", "--port", String(port)],
      { timeout: 5000 },
    );
    assert.equal(child.status, 1, child.stderr.toString());
    assert.match(child.stderr.toString(), /EADDRINUSE/);
    assert.equal(
      await (await fetch(`http://127.0.0.1:${port}`)).text(),
      "original server",
    );
  },
);

test(
  "recovery proxy supports an IPv6 loopback backend",
  { timeout: 10000 },
  async (t) => {
    const upstream = http.createServer((_req, res) => res.end("healthy"));
    upstream.listen(0, "::1");
    await once(upstream, "listening");
    t.after(() => new Promise((resolve) => upstream.close(resolve)));
    const child = spawn(process.execPath, [
      "scripts/recover-frontend.mjs",
      "--port",
      "0",
      "--upstream",
      `http://[::1]:${upstream.address().port}`,
    ]);
    t.after(() => child.kill());
    const [data] = await once(child.stdout, "data");
    const response = await fetch(
      `${JSON.parse(data.toString()).url}/api/health`,
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "healthy");
  },
);
