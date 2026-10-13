import { randomUUID } from "node:crypto";
import { withDatabase } from "../db.ts";
import type {
  Asset,
  Blog,
  Draft,
  DuplicateMatch,
  HistoryCoverage,
  Job,
  JobInput,
  JobStatus,
} from "./types.ts";

export function initWorkflow() {
  withDatabase((db) =>
    db.exec(`
    CREATE TABLE IF NOT EXISTS owner_sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS workflow_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, source_url TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'queued', input_json TEXT NOT NULL,
      blog_id TEXT NOT NULL, category_id TEXT NOT NULL, category_name TEXT NOT NULL,
      draft_json TEXT, duplicates_json TEXT NOT NULL DEFAULT '[]', message TEXT NOT NULL DEFAULT '',
      published_url TEXT, publication_attempted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), ordinal INTEGER NOT NULL,
      original_name TEXT NOT NULL, file_hash TEXT NOT NULL, pixel_hash TEXT NOT NULL,
      perceptual_hash TEXT NOT NULL, upscaled_hash TEXT, upscaled_perceptual_hash TEXT,
      width INTEGER NOT NULL, height INTEGER NOT NULL, original_path TEXT NOT NULL, upscaled_path TEXT,
      UNIQUE(job_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS assets_file_hash ON assets(file_hash);
    CREATE INDEX IF NOT EXISTS assets_pixel_hash ON assets(pixel_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_published_url ON jobs(published_url) WHERE published_url IS NOT NULL;
    CREATE TABLE IF NOT EXISTS history_posts (
      url TEXT PRIMARY KEY, blog_id TEXT NOT NULL, source_urls_json TEXT NOT NULL,
      image_hashes_json TEXT NOT NULL, title TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_events (
      id INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), status TEXT NOT NULL, message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `),
  );
}
const decode = (row: Record<string, unknown>): Job => {
  const {
    input_json,
    draft_json,
    duplicates_json,
    request_id: _request,
    ...rest
  } = row;
  return {
    ...rest,
    input: JSON.parse(String(input_json)),
    draft: draft_json ? JSON.parse(String(draft_json)) : null,
    duplicate_matches: JSON.parse(String(duplicates_json)),
  } as Job;
};
export function getJob(id: string): Job | null {
  return withDatabase((db) => {
    const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
    return row ? decode(row) : null;
  });
}
export function listJobs(): Job[] {
  return withDatabase((db) =>
    db
      .prepare(
        "SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT 100",
      )
      .all()
      .map(decode),
  );
}
export function createJob(
  input: JobInput,
  requestId: string,
  blogId: string,
  categoryId: string,
  categoryName: string,
): { job: Job; duplicate: boolean; replay: boolean } {
  return withDatabase((db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const replay = db
        .prepare("SELECT * FROM jobs WHERE request_id = ?")
        .get(requestId);
      if (replay) {
        db.exec("COMMIT");
        return { job: decode(replay), duplicate: false, replay: true };
      }
      const url = input.sourceUrl || `upload:${randomUUID()}`;
      const duplicate = db
        .prepare("SELECT * FROM jobs WHERE source_url = ?")
        .get(url);
      if (duplicate) {
        db.exec("COMMIT");
        return { job: decode(duplicate), duplicate: true, replay: false };
      }
      const legacy = db
        .prepare("SELECT * FROM posts WHERE source_url = ?")
        .get(url);
      const history = db
        .prepare("SELECT * FROM history_posts WHERE source_urls_json LIKE ?")
        .all(`%${url}%`)
        .find((row) => JSON.parse(String(row.source_urls_json)).includes(url));
      const id = randomUUID();
      db.prepare(
        "INSERT INTO jobs (id, request_id, source_url, input_json, blog_id, category_id, category_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting_images')",
      ).run(
        id,
        requestId,
        url,
        JSON.stringify(input),
        blogId,
        categoryId,
        categoryName,
      );
      if (legacy || history) {
        const matches: DuplicateMatch[] = [
          {
            reason: history
              ? "기존 네이버 게시물에 같은 인스타그램 URL이 있습니다."
              : "이전에 등록한 인스타그램 URL입니다.",
            jobId: null,
            postUrl: history ? String(history.url) : null,
          },
        ];
        db.prepare(
          "UPDATE jobs SET status = 'duplicate', duplicates_json = ?, message = ? WHERE id = ?",
        ).run(JSON.stringify(matches), matches[0].reason, id);
      }
      const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id)!;
      db.exec("COMMIT");
      return {
        job: decode(row),
        duplicate: Boolean(legacy || history),
        replay: false,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}
export function transition(id: string, status: JobStatus, message: string) {
  withDatabase((db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE jobs SET status = ?, message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
      ).run(status, message, id);
      db.prepare(
        "INSERT INTO job_events(job_id, status, message) VALUES (?, ?, ?)",
      ).run(id, status, message);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}
export function setDraft(id: string, draft: Draft) {
  withDatabase((db) =>
    db
      .prepare(
        "UPDATE jobs SET draft_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
      )
      .run(JSON.stringify(draft), id),
  );
}
export function saveExtractedCaption(id: string, caption: string) {
  withDatabase((db) =>
    db
      .prepare(
        "UPDATE jobs SET input_json = json_set(input_json, '$.caption', ?) WHERE id = ? AND json_extract(input_json, '$.caption') = ''",
      )
      .run(caption.slice(0, 8000), id),
  );
}
export function recordDuplicates(id: string, matches: DuplicateMatch[]) {
  withDatabase((db) =>
    db
      .prepare("UPDATE jobs SET duplicates_json = ? WHERE id = ?")
      .run(JSON.stringify(matches), id),
  );
}
export function listAssets(id: string): Asset[] {
  return withDatabase(
    (db) =>
      db
        .prepare("SELECT * FROM assets WHERE job_id = ? ORDER BY ordinal")
        .all(id) as Asset[],
  );
}
export function getAsset(id: string): Asset | null {
  return withDatabase(
    (db) =>
      (db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as Asset) ||
      null,
  );
}
export function addAsset(asset: Asset) {
  withDatabase((db) =>
    db
      .prepare(
        `INSERT INTO assets
    (id,job_id,ordinal,original_name,file_hash,pixel_hash,perceptual_hash,upscaled_hash,upscaled_perceptual_hash,width,height,original_path,upscaled_path)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        asset.id,
        asset.job_id,
        asset.ordinal,
        asset.original_name,
        asset.file_hash,
        asset.pixel_hash,
        asset.perceptual_hash,
        asset.upscaled_hash,
        asset.upscaled_perceptual_hash,
        asset.width,
        asset.height,
        asset.original_path,
        asset.upscaled_path,
      ),
  );
}
export function setUpscaled(
  id: string,
  path: string,
  hash: string,
  perceptual: string,
) {
  withDatabase((db) =>
    db
      .prepare(
        "UPDATE assets SET upscaled_path = ?, upscaled_hash = ?, upscaled_perceptual_hash = ? WHERE id = ?",
      )
      .run(path, hash, perceptual, id),
  );
}
export function getSetting<T>(name: string, fallback: T): T {
  return withDatabase((db) => {
    const row = db
      .prepare("SELECT value FROM workflow_settings WHERE name = ?")
      .get(name);
    return row ? JSON.parse(String(row.value)) : fallback;
  });
}
export function setSetting(name: string, value: unknown) {
  withDatabase((db) =>
    db
      .prepare(
        "INSERT INTO workflow_settings VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
      )
      .run(name, JSON.stringify(value)),
  );
}
export function blogs() {
  return getSetting<Blog[]>("blogs", []);
}
export function historyCoverage() {
  return getSetting<HistoryCoverage>("history", {
    complete: false,
    scanned: 0,
    total: null,
    message: "기존 네이버 게시물은 아직 비교하지 못했습니다.",
    syncedAt: null,
  });
}
// Persist the barrier BEFORE any externally visible publish click. Ambiguous outcomes never retry that click.
export function claimPublication(id: string): boolean {
  return withDatabase((db) =>
    Boolean(
      db
        .prepare(
          "UPDATE jobs SET status = 'publishing', publication_attempted = 1 WHERE id = ? AND publication_attempted = 0 AND status IN ('ready','manual_completion')",
        )
        .run(id).changes,
    ),
  );
}
export function markPublished(id: string, url: string) {
  withDatabase((db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE jobs SET published_url = ?, status = 'published', publication_attempted = 1, message = '실제 네이버 게시물 URL을 확인했습니다.', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
      ).run(url, id);
      db.prepare(
        "INSERT INTO job_events(job_id,status,message) VALUES (?, 'published', '실제 네이버 게시물 URL을 확인했습니다.')",
      ).run(id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}
export function saveReviewedDraft(id: string, draft: Draft): boolean {
  return withDatabase((db) =>
    Boolean(
      db
        .prepare(
          "UPDATE jobs SET draft_json = ? WHERE id = ? AND publication_attempted = 0 AND status IN ('awaiting_ai','ready','failed')",
        )
        .run(JSON.stringify(draft), id).changes,
    ),
  );
}
export function events(id: string) {
  return withDatabase((db) =>
    db
      .prepare(
        "SELECT status,message,created_at FROM job_events WHERE job_id = ? ORDER BY id",
      )
      .all(id),
  );
}
export function recoverInterruptedJobs() {
  const interrupted = withDatabase((db) =>
    db
      .prepare(
        "SELECT * FROM jobs WHERE status IN ('uploading','extracting','processing','writing','preparing_editor','publishing')",
      )
      .all()
      .map(decode),
  );
  for (const job of interrupted) {
    if (job.publication_attempted && job.status !== "published")
      transition(
        job.id,
        "verification_required",
        "이전 발행 결과 확인이 필요합니다. 같은 글을 다시 발행하지 않습니다.",
      );
    else if (
      [
        "uploading",
        "extracting",
        "processing",
        "writing",
        "preparing_editor",
      ].includes(job.status)
    )
      transition(
        job.id,
        "failed",
        "서버가 재시작되었습니다. 저장된 사진을 유지한 채 재시도할 수 있습니다.",
      );
  }
}
export function claimNextJob(): Job | null {
  return withDatabase((db) => {
    const row = db
      .prepare(
        "UPDATE jobs SET status = 'processing', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY rowid LIMIT 1) AND status = 'queued' RETURNING *",
      )
      .get();
    return row ? decode(row) : null;
  });
}
export function claimPhotoUpload(id: string): boolean {
  const claimed = withDatabase((db) =>
    Boolean(
      db
        .prepare(
          "UPDATE jobs SET status = 'uploading', draft_json = NULL WHERE id = ? AND publication_attempted = 0 AND status IN ('waiting_images','failed','awaiting_ai','ready')",
        )
        .run(id).changes,
    ),
  );
  if (claimed) setSetting(`photos-confirmed:${id}`, false);
  return claimed;
}
