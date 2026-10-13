import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { withDatabase } from "../db.ts";

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const attempts: number[] = [];
export function loginOwner(password: string): string | null {
  const expected = process.env.APP_OWNER_PASSWORD;
  if (!expected || expected.length < 12)
    throw new Error("OWNER_SETUP_REQUIRED");
  const now = Date.now();
  while (attempts.length && attempts[0] < now - 60_000) attempts.shift();
  if (attempts.length >= 10) throw new Error("LOGIN_RATE_LIMITED");
  attempts.push(now);
  const salt = "naver-blog-auto-owner-login-v1";
  if (
    !timingSafeEqual(
      scryptSync(password.slice(0, 256), salt, 32),
      scryptSync(expected, salt, 32),
    )
  )
    return null;
  const token = randomBytes(32).toString("base64url");
  withDatabase((db) => {
    db.prepare("DELETE FROM owner_sessions WHERE expires_at <= ?").run(now);
    db.prepare("INSERT INTO owner_sessions VALUES (?, ?)").run(
      hash(token),
      now + 12 * 60 * 60 * 1000,
    );
  });
  return token;
}
export function isOwnerSession(token: string | null): boolean {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  return withDatabase((db) =>
    Boolean(
      db
        .prepare(
          "SELECT 1 FROM owner_sessions WHERE hash = ? AND expires_at > ?",
        )
        .get(hash(token), Date.now()),
    ),
  );
}
export function logoutOwner(token: string) {
  withDatabase((db) =>
    db.prepare("DELETE FROM owner_sessions WHERE hash = ?").run(hash(token)),
  );
}
export function tokenMatches(
  value: string | null,
  expected: string | undefined,
) {
  return Boolean(
    value &&
      expected &&
      expected.length >= 24 &&
      timingSafeEqual(Buffer.from(hash(value)), Buffer.from(hash(expected))),
  );
}
