export type JobStatus =
  | "uploading"
  | "queued"
  | "extracting"
  | "waiting_images"
  | "processing"
  | "writing"
  | "awaiting_ai"
  | "ready"
  | "duplicate"
  | "preparing_editor"
  | "manual_completion"
  | "publishing"
  | "verification_required"
  | "published"
  | "failed";
export type DraftBlock = { text: string; imageIndex: number | null };
export type Draft = {
  title: string;
  blocks: DraftBlock[];
  hashtags: string[];
  origin: "openai" | "manual";
};
export type JobInput = {
  sourceUrl: string;
  caption: string;
  location: string;
  salon: string;
  confirmedTreatments: string;
  mode: "draft" | "publish";
  rightsConfirmed: boolean;
};
export type DuplicateMatch = {
  reason: string;
  jobId: string | null;
  postUrl: string | null;
  distance?: number;
};
export type Job = {
  id: string;
  source_url: string;
  status: JobStatus;
  input: JobInput;
  blog_id: string;
  category_id: string;
  category_name: string;
  draft: Draft | null;
  duplicate_matches: DuplicateMatch[];
  message: string;
  published_url: string | null;
  publication_attempted: number;
  created_at: string;
  updated_at: string;
};
export type Asset = {
  id: string;
  job_id: string;
  ordinal: number;
  original_name: string;
  file_hash: string;
  pixel_hash: string;
  perceptual_hash: string;
  upscaled_hash: string | null;
  upscaled_perceptual_hash: string | null;
  width: number;
  height: number;
  original_path: string;
  upscaled_path: string | null;
};
export type Blog = {
  id: string;
  name: string;
  categories: { id: string; name: string }[];
};
export type HistoryCoverage = {
  complete: boolean;
  scanned: number;
  total: number | null;
  message: string;
  syncedAt: string | null;
};
export type Connection = {
  connected: boolean;
  browserOpen: boolean;
  officialUrl: string | null;
  blogs: Blog[];
  selectedBlog: string | null;
  selectedCategory: string | null;
  history: HistoryCoverage;
};
export const TERMINAL_STATES: JobStatus[] = [
  "published",
  "duplicate",
  "verification_required",
];
