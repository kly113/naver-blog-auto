import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (
  !process.env.APP_OWNER_PASSWORD ||
  process.env.APP_OWNER_PASSWORD.length < 12
)
  throw new Error(
    "Set APP_OWNER_PASSWORD (12+ characters) securely in local environment configuration.",
  );
const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? args[portIndex + 1] : "3000";
const workerPort = process.env.WORKER_PORT || "4000";
const directory = resolve(process.env.DATA_DIR || "./data");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const keyPath = join(directory, "local-worker-keys.json");
let keys;
try {
  keys = JSON.parse(readFileSync(keyPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  keys = {
    worker: randomBytes(32).toString("base64url"),
    session: randomBytes(32).toString("base64url"),
  };
  writeFileSync(keyPath, JSON.stringify(keys), { mode: 0o600, flag: "wx" });
}
const environment = {
  ...process.env,
  WORKER_URL: `http://127.0.0.1:${workerPort}`,
  WORKER_AUTH_TOKEN: process.env.WORKER_AUTH_TOKEN || keys.worker,
  SESSION_ENCRYPTION_KEY: process.env.SESSION_ENCRYPTION_KEY || keys.session,
  APP_PUBLIC_URL: `http://127.0.0.1:${port}`,
  NEXT_TELEMETRY_DISABLED: "1",
};
const worker = spawn(
  process.execPath,
  ["--experimental-strip-types", "worker/server.ts"],
  {
    env: { ...environment, PORT: workerPort, WORKER_HOST: "127.0.0.1" },
    stdio: "inherit",
  },
);
const web = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  { env: environment, stdio: "inherit" },
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  worker.kill("SIGTERM");
  web.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1000);
}
for (const child of [worker, web]) {
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
