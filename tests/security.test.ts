import { afterEach, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { sealSession, openSession } from "../src/lib/workflow/session-vault";
import {
  isApprovedMediaUrl,
  isPublicAddress,
} from "../src/lib/workflow/network";
import { hashDistance, perceptualHash } from "../src/lib/workflow/photos";
import { parseNaverPostUrl } from "../src/lib/workflow/history";
import { draftHtml } from "../src/lib/workflow/export";
import sharp from "sharp";
const original = process.env.SESSION_ENCRYPTION_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
  else process.env.SESSION_ENCRYPTION_KEY = original;
});
it("encrypts cookies at rest, rejects tampering, and fails closed without a key", () => {
  process.env.SESSION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const value = {
    cookies: [{ name: "NID_SES", value: "test-cookie-not-real" }],
  };
  const encrypted = sealSession(value);
  expect(encrypted.includes(Buffer.from("test-cookie-not-real"))).toBe(false);
  expect(openSession(encrypted)).toEqual(value);
  encrypted[encrypted.length - 1] ^= 1;
  expect(() => openSession(encrypted)).toThrow();
  delete process.env.SESSION_ENCRYPTION_KEY;
  expect(() => sealSession(value)).toThrow();
});
it.each([
  "127.0.0.1",
  "10.1.2.3",
  "169.254.169.254",
  "172.16.0.1",
  "192.168.2.1",
  "100.64.1.1",
  "::1",
  "fd00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
])("rejects private download address %s", (address) =>
  expect(isPublicAddress(address)).toBe(false),
);
it("allows only HTTPS image CDN addresses and genuine Naver post URLs", () => {
  expect(
    isApprovedMediaUrl("https://scontent.cdninstagram.com/photo.jpg"),
  ).toBe(true);
  for (const url of [
    "http://scontent.cdninstagram.com/photo.jpg",
    "https://cdninstagram.com.evil.test/x",
    "https://user:pass@img.pstatic.net/x",
    "https://127.0.0.1/x",
  ])
    expect(isApprovedMediaUrl(url)).toBe(false);
  expect(
    parseNaverPostUrl("https://blog.naver.com/owner/123", "owner")?.url,
  ).toBe("https://blog.naver.com/owner/123");
  expect(
    parseNaverPostUrl("https://blog.naver.com/other/123", "owner"),
  ).toBeNull();
  expect(
    parseNaverPostUrl("https://blog.naver.com.evil.test/owner/123"),
  ).toBeNull();
});
it("retains resize similarity and detects large perceptual differences", async () => {
  const pixels = Buffer.alloc(16 * 16 * 3);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++)
      for (let c = 0; c < 3; c++)
        pixels[(y * 16 + x) * 3 + c] = x < 8 ? 30 : 220;
  const original = await sharp(pixels, {
    raw: { width: 16, height: 16, channels: 3 },
  })
    .png()
    .toBuffer();
  const scaled = await sharp(original).resize(32, 32).png().toBuffer();
  expect(
    hashDistance(await perceptualHash(original), await perceptualHash(scaled)),
  ).toBeLessThanOrEqual(4);
  expect(hashDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
});
it("escapes draft HTML and arranges mobile-friendly centered photos in order", () => {
  const html = draftHtml({
    title: "<script>alert(1)</script>",
    blocks: [
      { text: "<img src=x onerror=alert(1)>", imageIndex: 0 },
      { text: "다음 문단", imageIndex: 1 },
    ],
    hashtags: ["스타일"],
    origin: "manual",
  });
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("text-align:center");
  expect(html).toContain("max-width:100%");
  expect(html.indexOf("photos/01.png")).toBeLessThan(
    html.indexOf("photos/02.png"),
  );
});
