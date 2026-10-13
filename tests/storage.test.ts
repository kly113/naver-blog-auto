import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  createPost,
  getProfile,
  listImages,
  listPosts,
  registerImage,
  saveProfile,
} from "../src/lib/db";
import {
  normalizeInstagramUrl,
  postSchema,
  profileSchema,
} from "../src/lib/validation";
import { fingerprintImage } from "../src/lib/images";

let directory: string;
const originalDataDir = process.env.DATA_DIR;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "blog-test-"));
  process.env.DATA_DIR = directory;
});
afterEach(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  rmSync(directory, { recursive: true, force: true });
});

describe("profile and content persistence", () => {
  it("initializes an empty database and retains saved account settings", () => {
    expect(getProfile()).toBeNull();
    const profile = profileSchema.parse({
      blogId: "travel_blog",
      displayName: "여행 기록",
      categories: ["여행", "여행", "일상"],
      selectedCategory: "여행",
    });
    saveProfile(profile);
    expect(getProfile()).toEqual({ ...profile, categories: ["여행", "일상"] });
    saveProfile({ ...profile, selectedCategory: "일상" });
    expect(getProfile()?.selectedCategory).toBe("일상");
  });
  it("rejects categories not in the registered list", () => {
    expect(
      profileSchema.safeParse({
        blogId: "test",
        displayName: "test",
        categories: ["여행"],
        selectedCategory: "맛집",
      }).success,
    ).toBe(false);
  });
  it("normalizes URLs and prevents duplicates across new database connections", () => {
    const url = normalizeInstagramUrl(
      "https://instagram.com/p/ABC_12/?utm_source=copy#photo",
    );
    expect(url).toBe("https://www.instagram.com/p/ABC_12/");
    expect(createPost(url, "여행")?.status).toBe("draft");
    expect(
      createPost(
        normalizeInstagramUrl("https://www.instagram.com/p/ABC_12"),
        "여행",
      ),
    ).toBeNull();
    expect(listPosts()).toHaveLength(1);
  });
  it.each([
    "http://instagram.com/p/x",
    "https://instagram.com.evil.test/p/x",
    "https://user:pass@instagram.com/p/x",
    "https://instagram.com/explore",
    "https://instagram.com:444/p/x",
  ])("rejects unsafe or unsupported URL %s", (url) => {
    expect(postSchema.safeParse({ url }).success).toBe(false);
  });
});

describe("image fingerprints", () => {
  it("detects identical decoded pixels despite different PNG encodings", async () => {
    const raw = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]);
    const first = await sharp(raw, {
      raw: { width: 2, height: 1, channels: 4 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const second = await sharp(raw, {
      raw: { width: 2, height: 1, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const a = await fingerprintImage(first);
    const b = await fingerprintImage(second);
    expect(a.file_hash).not.toBe(b.file_hash);
    expect(a.pixel_hash).toBe(b.pixel_hash);
    expect(registerImage({ ...a, original_name: "one.png" })).toBe(true);
    expect(registerImage({ ...b, original_name: "two.png" })).toBe(false);
    expect(listImages()).toHaveLength(1);
  });
  it("rejects invalid image bytes", async () => {
    await expect(
      fingerprintImage(Buffer.from("not an image")),
    ).rejects.toThrow();
  });
});
