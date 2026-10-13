import { ZipArchive } from "archiver";
import { PassThrough, Readable } from "node:stream";
import type { Asset, Draft, Job } from "./types.ts";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export function draftHtml(draft: Draft) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(draft.title)}</title><style>body{margin:24px auto;max-width:680px;padding:0 20px;text-align:center;font-family:sans-serif;color:#222;line-height:1.9}h1{font-size:26px}p{margin:28px 0;white-space:pre-wrap}img{max-width:100%;height:auto;display:block;margin:32px auto}.tags{color:#56756a}</style><h1>${escape(draft.title)}</h1>${draft.blocks.map((block) => `${block.text ? `<p>${escape(block.text)}</p>` : ""}${block.imageIndex !== null ? `<img src="photos/${String(block.imageIndex + 1).padStart(2, "0")}.png" alt="사진 ${block.imageIndex + 1}">` : ""}`).join("")}<p class="tags">${draft.hashtags.map((tag) => `#${escape(tag)}`).join(" ")}</p></html>`;
}
export function draftText(draft: Draft) {
  return [
    draft.title,
    ...draft.blocks.map(
      (block) =>
        `${block.text}${block.imageIndex === null ? "" : `\n[사진 ${block.imageIndex + 1}]`}`,
    ),
    draft.hashtags.map((tag) => `#${tag}`).join(" "),
  ].join("\n\n");
}
export function exportBundle(job: Job, assets: Asset[]): Response {
  if (!job.draft) throw new Error("먼저 초안을 작성하세요.");
  const output = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 3 } });
  archive.on("error", (error) => output.destroy(error));
  archive.pipe(output);
  archive.on("warning", (error) => output.destroy(error));
  archive.append(draftHtml(job.draft), { name: "미리보기.html" });
  archive.append(draftText(job.draft), { name: "블로그-본문.txt" });
  archive.append(
    "네이버 공식 글쓰기 화면에서 제목과 본문을 입력하고, photos 폴더의 확대 사진을 번호 순서대로 넣어 주세요. 본문은 가운데 정렬을 선택하고 문단 사이에 여백을 주세요. 스티커는 네이버 편집기의 스티커 도구에서 직접 선택할 수 있습니다. 카테고리와 사진 사용 권한을 확인한 뒤 직접 임시저장 또는 발행을 완료하세요.\n",
    { name: "사용방법.txt" },
  );
  for (const asset of assets)
    archive.file(asset.upscaled_path || asset.original_path, {
      name: `photos/${String(asset.ordinal + 1).padStart(2, "0")}.png`,
    });
  void archive.finalize().catch((error) => output.destroy(error));
  return new Response(Readable.toWeb(output) as ReadableStream<Uint8Array>, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="blog-${job.id}.zip"`,
      "cache-control": "no-store",
    },
  });
}
