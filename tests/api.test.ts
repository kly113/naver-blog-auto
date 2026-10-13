import { beforeEach, afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  POST as saveProfile,
  GET as readProfile,
} from "../src/app/api/profile/route";
import { POST as addPost } from "../src/app/api/posts/route";
import { POST as addImage } from "../src/app/api/images/route";

let directory: string;
const previous = process.env.DATA_DIR;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "blog-api-"));
  process.env.DATA_DIR = directory;
});
afterEach(() => {
  if (previous === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previous;
  rmSync(directory, { recursive: true, force: true });
});
const jsonRequest = (
  path: string,
  body: unknown,
  origin = "http://localhost:3000",
) =>
  new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
const profile = {
  blogId: "my_blog",
  displayName: "내 블로그",
  categories: ["여행"],
  selectedCategory: "여행",
};

it("keeps login status disconnected while saving profile and category", async () => {
  expect((await saveProfile(jsonRequest("/api/profile", profile))).status).toBe(
    200,
  );
  expect(await (await readProfile()).json()).toEqual({
    profile,
    connection: "not_connected",
  });
});
it("requires profile setup and returns conflict for duplicate normalized URL", async () => {
  const post = { url: "https://instagram.com/reel/abc/?utm_source=copy" };
  expect((await addPost(jsonRequest("/api/posts", post))).status).toBe(409);
  await saveProfile(jsonRequest("/api/profile", profile));
  expect((await addPost(jsonRequest("/api/posts", post))).status).toBe(201);
  expect(
    (
      await addPost(
        jsonRequest("/api/posts", {
          url: "https://www.instagram.com/reel/abc/",
        }),
      )
    ).status,
  ).toBe(409);
});
it("rejects cross-origin mutations and invalid payloads", async () => {
  expect(
    (
      await saveProfile(
        jsonRequest("/api/profile", profile, "https://evil.test"),
      )
    ).status,
  ).toBe(403);
  expect(
    (await addPost(jsonRequest("/api/posts", { url: "https://example.com/" })))
      .status,
  ).toBe(400);
  expect(
    (
      await saveProfile(
        new Request("http://localhost:3000/api/profile", {
          method: "POST",
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
});
it("accepts same-origin browser requests when Next uses an internal bind address", async () => {
  const request = new Request("http://0.0.0.0:3000/api/profile", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(profile),
  });
  expect((await saveProfile(request)).status).toBe(200);
});
it("uploads an image and rejects a duplicate or corrupt image", async () => {
  const bytes = await sharp({
    create: { width: 3, height: 2, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const upload = async (buffer: Buffer) => {
    const form = new FormData();
    form.append(
      "image",
      new File([new Uint8Array(buffer)], "test.png", { type: "image/png" }),
    );
    return addImage(
      new Request("http://localhost:3000/api/images", {
        method: "POST",
        body: form,
      }),
    );
  };
  expect((await upload(bytes)).status).toBe(201);
  expect((await upload(bytes)).status).toBe(409);
  expect((await upload(Buffer.from("not an image"))).status).toBe(400);
});
