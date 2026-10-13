import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { WorkerRuntime } from "./runtime.ts";

if (!process.env.WORKER_AUTH_TOKEN || process.env.WORKER_AUTH_TOKEN.length < 24)
  throw new Error("WORKER_AUTH_TOKEN (24+ characters) required");
const runtime = new WorkerRuntime();
runtime.start();
const server = createServer(async (incoming: IncomingMessage, outgoing) => {
  try {
    const host = "127.0.0.1";
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers))
      if (value)
        headers.set(name, Array.isArray(value) ? value.join(",") : value);
    const init: RequestInit & { duplex?: "half" } = {
      method: incoming.method,
      headers,
    };
    if (!["GET", "HEAD"].includes(incoming.method || "GET")) {
      init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      init.duplex = "half";
    }
    const response = await runtime.handle(
      new Request(`http://${host}${incoming.url}`, init),
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      const stream = Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream<Uint8Array>,
      );
      stream.on("error", () => outgoing.destroy());
      outgoing.on("close", () => stream.destroy());
      stream.pipe(outgoing);
    } else outgoing.end();
  } catch {
    if (!outgoing.headersSent)
      outgoing.writeHead(500, { "content-type": "application/json" });
    outgoing.end('{"error":"처리하지 못한 요청입니다."}');
  }
});
server.requestTimeout = 150_000;
server.headersTimeout = 15_000;
server.listen(
  Number(process.env.PORT || 4000),
  process.env.WORKER_HOST || "127.0.0.1",
  () => console.log("Private automation worker ready"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close();
    void runtime.close().finally(() => process.exit(0));
  });
