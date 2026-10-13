import sharp from "sharp";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { dataDirectory, withDatabase } from "../db.ts";
import { fingerprintImage, MAX_IMAGE_BYTES } from "../images.ts";
import { addAsset, listAssets, setUpscaled } from "./store.ts";
import type { Asset, DuplicateMatch } from "./types.ts";

export async function perceptualHash(bytes: Buffer): Promise<string> {
  const pixels = await sharp(bytes, { limitInputPixels: 100_000_000 })
    .rotate()
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  let result = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      result =
        (result << 1n) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1n : 0n);
  return result.toString(16).padStart(16, "0");
}
export function hashDistance(left: string, right: string): number {
  if (!/^[0-9a-f]{16}$/.test(left) || !/^[0-9a-f]{16}$/.test(right)) return 64;
  let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (difference) {
    difference &= difference - 1n;
    count++;
  }
  return count;
}
export async function storePhoto(
  jobId: string,
  file: { name: string; bytes: Buffer },
): Promise<Asset> {
  const assets = listAssets(jobId);
  if (assets.length >= 20) throw new Error("최대 20장의 사진을 지원합니다.");
  const fingerprint = await fingerprintImage(file.bytes);
  if (fingerprint.width * fingerprint.height * 4 > 100_000_000)
    throw new Error("2배 확대 결과가 1억 화소를 초과합니다.");
  if (
    assets.some(
      (asset) =>
        asset.file_hash === fingerprint.file_hash ||
        asset.pixel_hash === fingerprint.pixel_hash,
    )
  )
    throw new Error("같은 작업에 동일한 사진이 포함되어 있습니다.");
  const id = randomUUID();
  const directory = join(dataDirectory(), "assets");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${id}-original.png`);
  const previewPath = join(directory, `${id}-preview.jpg`);
  // Strip location/EXIF metadata without generative retouching.
  const original = await sharp(file.bytes)
    .rotate()
    .toColourspace("srgb")
    .png()
    .toBuffer();
  await writeFile(path, original, { mode: 0o600 });
  const preview = await sharp(original)
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "white" })
    .jpeg({ quality: 85 })
    .toBuffer();
  await writeFile(previewPath, preview, { mode: 0o600 });
  const asset: Asset = {
    id,
    job_id: jobId,
    ordinal: assets.length,
    original_name: file.name.slice(0, 200),
    ...fingerprint,
    perceptual_hash: await perceptualHash(original),
    upscaled_hash: null,
    upscaled_perceptual_hash: null,
    original_path: path,
    upscaled_path: null,
  };
  try {
    addAsset(asset);
  } catch (error) {
    await unlink(path);
    await unlink(previewPath);
    throw error;
  }
  return asset;
}
export async function upscalePhoto(asset: Asset) {
  if (asset.upscaled_path) return;
  const target = join(dataDirectory(), "assets", `${asset.id}-2x.png`);
  // A previous process may have finished the file before committing its DB row.
  await unlink(target).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const python =
    process.env.PYTHON_EXECUTABLE ||
    join(process.cwd(), ".venv", "bin", "python");
  await new Promise<void>((resolve, reject) => {
    const processHandle = spawn(
      python,
      [
        join(process.cwd(), "python", "upscale.py"),
        asset.original_path,
        target,
        "--scale",
        "2",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      processHandle.kill("SIGKILL");
    }, 120_000);
    // Drain stderr, but do not include image paths or raw error content in user-visible output.
    processHandle.stderr.resume();
    processHandle.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    processHandle.on("exit", (code) => {
      clearTimeout(timeout);
      code === 0 && !timedOut
        ? resolve()
        : reject(
            new Error(
              timedOut
                ? "사진 확대 시간이 초과되었습니다."
                : "사진 확대에 실패했습니다.",
            ),
          );
    });
  });
  const bytes = await readFile(target);
  const metadata = await sharp(bytes).metadata();
  if (
    metadata.width !== asset.width * 2 ||
    metadata.height !== asset.height * 2
  )
    throw new Error("사진 확대 크기 검증에 실패했습니다.");
  setUpscaled(
    asset.id,
    target,
    createHash("sha256").update(bytes).digest("hex"),
    await perceptualHash(bytes),
  );
}
export function findPhotoDuplicates(jobId: string): DuplicateMatch[] {
  const mine = listAssets(jobId);
  const matches: DuplicateMatch[] = [];
  withDatabase((db) => {
    const others = db
      .prepare(
        "SELECT a.*, j.published_url FROM assets a JOIN jobs j ON j.id = a.job_id WHERE a.job_id != ?",
      )
      .all(jobId);
    for (const photo of mine) {
      const legacy = db
        .prepare("SELECT id FROM images WHERE file_hash = ? OR pixel_hash = ?")
        .get(photo.file_hash, photo.pixel_hash);
      if (legacy)
        matches.push({
          reason: "이전에 등록한 이미지와 파일 또는 픽셀이 같습니다.",
          jobId: null,
          postUrl: null,
        });
      for (const row of others) {
        const distance = Math.min(
          hashDistance(photo.perceptual_hash, String(row.perceptual_hash)),
          row.upscaled_perceptual_hash
            ? hashDistance(
                photo.perceptual_hash,
                String(row.upscaled_perceptual_hash),
              )
            : 64,
        );
        const aspectDifference = Math.abs(
          photo.width / photo.height - Number(row.width) / Number(row.height),
        );
        if (
          photo.file_hash === row.file_hash ||
          photo.pixel_hash === row.pixel_hash ||
          (photo.upscaled_hash && photo.upscaled_hash === row.upscaled_hash) ||
          (distance <= 4 && aspectDifference < 0.05)
        )
          matches.push({
            reason:
              distance <= 4
                ? "원본·확대 이미지의 시각적 유사도가 높습니다. 수동 확인이 필요합니다."
                : "동일한 사진이 다른 작업에 사용되었습니다.",
            jobId: String(row.job_id),
            postUrl: row.published_url ? String(row.published_url) : null,
            distance,
          });
      }
      const history = db
        .prepare("SELECT url,image_hashes_json FROM history_posts")
        .all();
      for (const row of history)
        for (const hash of JSON.parse(String(row.image_hashes_json)) as {
          hash: string;
          ratio: number;
        }[])
          if (
            hashDistance(photo.perceptual_hash, hash.hash) <= 4 &&
            Math.abs(photo.width / photo.height - hash.ratio) < 0.05
          )
            matches.push({
              reason: "기존 네이버 발행 기록에서 유사한 사진을 찾았습니다.",
              jobId: null,
              postUrl: String(row.url),
            });
    }
  });
  return matches.filter(
    (match, index, array) =>
      array.findIndex(
        (other) =>
          other.jobId === match.jobId &&
          other.postUrl === match.postUrl &&
          other.reason === match.reason,
      ) === index,
  );
}
export async function aiPhotoData(asset: Asset) {
  const bytes = await sharp(asset.original_path)
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
export { MAX_IMAGE_BYTES };
