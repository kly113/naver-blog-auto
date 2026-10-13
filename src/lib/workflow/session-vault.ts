import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { dataDirectory } from "../db.ts";

function key() {
  const value = process.env.SESSION_ENCRYPTION_KEY;
  if (!value || value.length < 32) throw new Error("SESSION_KEY_REQUIRED");
  return createHash("sha256").update(value).digest();
}
export function sealSession(value: unknown): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from("naver-session-v1"));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([Buffer.from("NBS1"), iv, cipher.getAuthTag(), body]);
}
export function openSession(bytes: Buffer): unknown {
  if (bytes.length < 32 || bytes.subarray(0, 4).toString() !== "NBS1")
    throw new Error("INVALID_SESSION");
  const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(4, 16));
  cipher.setAAD(Buffer.from("naver-session-v1"));
  cipher.setAuthTag(bytes.subarray(16, 32));
  return JSON.parse(
    Buffer.concat([cipher.update(bytes.subarray(32)), cipher.final()]).toString(
      "utf8",
    ),
  );
}
export async function saveBrowserSession(value: unknown) {
  const path = join(dataDirectory(), "naver-session.enc");
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, sealSession(value), { mode: 0o600 });
  await rename(temporary, path);
}
export async function loadBrowserSession(): Promise<unknown | null> {
  try {
    return openSession(
      await readFile(join(dataDirectory(), "naver-session.enc")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function removeBrowserSession() {
  await unlink(join(dataDirectory(), "naver-session.enc")).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
