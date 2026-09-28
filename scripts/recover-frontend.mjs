import http from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "5173" },
    upstream: { type: "string", default: "http://127.0.0.1:8765" },
  },
});
const port = Number(values.port);
const upstream = new URL(values.upstream);
function isLoopbackOrigin(url) {
  return (
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash
  );
}
if (
  !Number.isInteger(port) ||
  port < 0 ||
  port > 65535 ||
  !isLoopbackOrigin(upstream)
) {
  throw new Error("Use a valid port and an HTTP loopback upstream origin.");
}
const hopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
function headers(source) {
  const blocked = new Set([
    ...hopHeaders,
    ...String(source.connection || "")
      .toLowerCase()
      .split(",")
      .map((value) => value.trim()),
  ]);
  return Object.fromEntries(
    Object.entries(source).filter(([name]) => !blocked.has(name.toLowerCase())),
  );
}
const server = http.createServer((req, res) => {
  let localHost = false;
  try {
    localHost = isLoopbackOrigin(new URL(`http://${req.headers.host}`));
  } catch {}
  if (!localHost) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("Only local application hosts are allowed.");
    return;
  }
  if (!req.url?.startsWith("/api/")) {
    res.writeHead(503, {
      "content-type": "text/plain",
      "cache-control": "no-store",
    });
    res.end(
      "Recording recovery only. Keep the original tab open and use Retry uploads & finish.",
    );
    return;
  }
  const target = http.request(
    {
      hostname: upstream.hostname === "[::1]" ? "::1" : upstream.hostname,
      port: upstream.port || 80,
      method: req.method,
      path: req.url,
      headers: headers(req.headers),
    },
    (response) => {
      res.writeHead(response.statusCode || 502, headers(response.headers));
      response.on("error", () => res.destroy());
      response.pipe(res);
    },
  );
  target.setTimeout(300000, () =>
    target.destroy(new Error("Upstream timed out")),
  );
  target.on("error", () => {
    if (res.headersSent) res.destroy();
    else {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          detail:
            "The LecNote backend is unavailable. Keep this tab open and retain the WAV backup.",
        }),
      );
    }
  });
  req.on("aborted", () => target.destroy());
  req.on("error", () => target.destroy());
  res.on("close", () => {
    if (!res.writableFinished) target.destroy();
  });
  req.pipe(target);
});
// Vite reloads the page when its ping WebSocket reconnects, losing retained audio.
server.on("upgrade", (_req, socket) =>
  socket.end(
    "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
  ),
);
server.on("clientError", (_error, socket) => socket.destroy());
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      url: `http://127.0.0.1:${server.address().port}`,
      upstream: upstream.origin,
      mode: "recovery-no-reload",
    }),
  ),
);
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
