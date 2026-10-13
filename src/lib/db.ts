import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { profileSchema } from "./validation.ts";

export type Profile = z.infer<typeof profileSchema>;
export type Post = {
  id: string;
  source_url: string;
  category: string;
  status: string;
  created_at: string;
};
export type ImageRecord = {
  id: string;
  file_hash: string;
  pixel_hash: string;
  original_name: string;
  width: number;
  height: number;
  created_at: string;
};

export function dataDirectory() {
  return resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || "./data");
}
export function openDatabase(): DatabaseSync {
  const directory = dataDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, "blog.sqlite"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      blog_id TEXT NOT NULL, display_name TEXT NOT NULL,
      categories_json TEXT NOT NULL, selected_category TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, source_url TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'failed')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY, file_hash TEXT NOT NULL UNIQUE, pixel_hash TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  return db;
}

export function withDatabase<T>(callback: (db: DatabaseSync) => T): T {
  const db = openDatabase();
  try {
    return callback(db);
  } finally {
    db.close();
  }
}
export function getProfile(): Profile | null {
  return withDatabase((db) => {
    const row = db.prepare("SELECT * FROM profile WHERE id = 1").get();
    if (!row) return null;
    return {
      blogId: String(row.blog_id),
      displayName: String(row.display_name),
      categories: JSON.parse(String(row.categories_json)),
      selectedCategory: String(row.selected_category),
    };
  });
}
export function saveProfile(profile: Profile) {
  withDatabase((db) =>
    db
      .prepare(
        `INSERT INTO profile VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET blog_id=excluded.blog_id, display_name=excluded.display_name,
    categories_json=excluded.categories_json, selected_category=excluded.selected_category`,
      )
      .run(
        profile.blogId,
        profile.displayName,
        JSON.stringify(profile.categories),
        profile.selectedCategory,
      ),
  );
}
export function listPosts(): Post[] {
  return withDatabase(
    (db) =>
      db
        .prepare(
          "SELECT * FROM posts ORDER BY created_at DESC, rowid DESC LIMIT 100",
        )
        .all() as Post[],
  );
}
export function createPost(url: string, category: string): Post | null {
  return withDatabase((db) => {
    const id = randomUUID();
    const result = db
      .prepare(
        "INSERT INTO posts (id, source_url, category) VALUES (?, ?, ?) ON CONFLICT(source_url) DO NOTHING",
      )
      .run(id, url, category);
    return result.changes
      ? (db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as Post)
      : null;
  });
}
export function listImages(): ImageRecord[] {
  return withDatabase(
    (db) =>
      db
        .prepare(
          "SELECT * FROM images ORDER BY created_at DESC, rowid DESC LIMIT 100",
        )
        .all() as ImageRecord[],
  );
}
export function registerImage(
  image: Omit<ImageRecord, "id" | "created_at">,
): boolean {
  return withDatabase((db) =>
    Boolean(
      db
        .prepare(
          `INSERT INTO images
    (id, file_hash, pixel_hash, original_name, width, height) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING`,
        )
        .run(
          randomUUID(),
          image.file_hash,
          image.pixel_hash,
          image.original_name,
          image.width,
          image.height,
        ).changes,
    ),
  );
}
