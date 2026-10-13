import sharp from "sharp";
import { createHash } from "node:crypto";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export async function fingerprintImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("이미지는 10MB 이하로 업로드하세요.");
  const input = sharp(bytes, { limitInputPixels: 25_000_000 });
  const metadata = await input.metadata();
  if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || !metadata.width || !metadata.height)
    throw new Error("JPEG, PNG, WebP 이미지만 지원합니다.");
  if ((metadata.pages ?? 1) > 1) throw new Error("움직이는 이미지는 지원하지 않습니다.");
  const { data, info } = await input.rotate().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    file_hash: createHash("sha256").update(bytes).digest("hex"),
    pixel_hash: createHash("sha256").update(`${info.width}x${info.height}:`).update(data).digest("hex"),
    width: info.width, height: info.height,
  };
}
