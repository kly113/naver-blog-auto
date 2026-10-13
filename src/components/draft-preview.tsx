"use client";
import { useEffect, useState } from "react";
import type { Draft } from "@/lib/workflow/types";
import type { Detail } from "./dashboard";
export default function DraftPreview({
  detail,
  busy,
  onSave,
}: {
  detail: Detail;
  busy: boolean;
  onSave: (draft: Draft) => Promise<boolean>;
}) {
  const { job, assets } = detail;
  const source = JSON.stringify(job.draft);
  const [draft, setDraft] = useState<Draft>(
    job.draft || {
      title: "나의 스타일 사진 기록",
      blocks: assets.map((asset, index) => ({
        text: index === 0 ? job.input.caption : "",
        imageIndex: asset.ordinal,
      })),
      hashtags: [],
      origin: "manual",
    },
  );
  const [editing, setEditing] = useState(!job.draft);
  const [tags, setTags] = useState(job.draft?.hashtags.join(" ") || "");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const next = job.draft || {
      title: "나의 스타일 사진 기록",
      blocks: assets.map((asset, index) => ({
        text: index === 0 ? job.input.caption : "",
        imageIndex: asset.ordinal,
      })),
      hashtags: [],
      origin: "manual" as const,
    };
    setDraft(next);
    setTags(next.hashtags.join(" "));
  }, [source, job.id]);
  const locked = [
    "published",
    "verification_required",
    "manual_completion",
  ].includes(job.status);
  async function copy() {
    await navigator.clipboard.writeText(
      [
        draft.title,
        ...draft.blocks.map((block) => block.text),
        draft.hashtags.map((tag) => `#${tag}`).join(" "),
      ].join("\n\n"),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="draft-section">
      <div className="section-heading">
        <div>
          <h2>작성된 글 미리보기</h2>
          <p className="hint">
            {job.draft?.origin === "openai"
              ? "AI 초안입니다. 시술 사실과 표현을 직접 확인해 주세요."
              : "직접 작성하는 초안입니다. AI가 작성한 글로 표시하지 않습니다."}
          </p>
        </div>
        <div className="button-row">
          <button
            className="link-button"
            disabled={locked}
            onClick={() => setEditing(!editing)}
          >
            {editing ? "미리보기" : "글 수정"}
          </button>
          <button
            className="link-button"
            onClick={() => void copy().catch(() => setCopied(false))}
          >
            {copied ? "복사 완료" : "본문 복사"}
          </button>
        </div>
      </div>
      {editing && !locked ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSave({
              ...draft,
              hashtags: tags
                .split(/[\s,]+/)
                .map((tag) => tag.replace(/^#+/, ""))
                .filter(Boolean),
              origin: "manual",
            }).then((saved) => {
              if (saved) setEditing(false);
            });
          }}
        >
          <label htmlFor={`draft-title-${job.id}`}>글 제목</label>
          <input
            id={`draft-title-${job.id}`}
            required
            maxLength={100}
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
          {draft.blocks.map((block, index) => (
            <div className="draft-edit-block" key={index}>
              <label htmlFor={`draft-block-${job.id}-${index}`}>
                문단 {index + 1}
                {block.imageIndex !== null
                  ? ` · 아래에 사진 ${block.imageIndex + 1} 삽입`
                  : ""}
              </label>
              <textarea
                id={`draft-block-${job.id}-${index}`}
                rows={4}
                maxLength={4000}
                value={block.text}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    blocks: draft.blocks.map((item, i) =>
                      i === index
                        ? { ...item, text: event.target.value }
                        : item,
                    ),
                  })
                }
              />
            </div>
          ))}
          <label htmlFor={`draft-tags-${job.id}`}>관련 해시태그</label>
          <input
            id={`draft-tags-${job.id}`}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="성수동 미용실 스타일"
          />
          <div className="form-footer">
            <span>확인되지 않은 시술이나 고객 경험은 추가하지 마세요.</span>
            <button disabled={busy}>초안 저장</button>
          </div>
        </form>
      ) : (
        <article className="blog-preview">
          <h2>{draft.title}</h2>
          {draft.blocks.map((block, index) => (
            <section key={index}>
              {block.text && <p>{block.text}</p>}
              {block.imageIndex !== null && assets[block.imageIndex] && (
                <img
                  src={assets[block.imageIndex].url}
                  alt={`사진 ${block.imageIndex + 1}`}
                />
              )}
            </section>
          ))}
          <p className="preview-tags">
            {draft.hashtags.map((tag) => `#${tag}`).join(" ")}
          </p>
        </article>
      )}
    </div>
  );
}
