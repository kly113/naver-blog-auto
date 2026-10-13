"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  Asset,
  Connection,
  Draft,
  Job,
  JobStatus,
} from "@/lib/workflow/types";
import RemoteBrowser from "./remote-browser";
import DraftPreview from "./draft-preview";

export type AssetView = Pick<Asset, "id" | "ordinal" | "width" | "height"> & {
  name: string;
  upscaled: boolean;
  url: string;
};
export type Detail = {
  job: Job;
  assets: AssetView[];
  events: { status: string; message: string; created_at: string }[];
  history: Connection["history"];
};
type Readiness = {
  aiConnected: boolean;
  automaticPublishingEnabled: boolean;
  saveFromVerified: boolean;
  stickerVerified: boolean;
  connection: Connection;
};
export const labels: Record<JobStatus, string> = {
  uploading: "사진 저장 중",
  queued: "대기 중",
  extracting: "사진 추출 중",
  waiting_images: "사진 확인 필요",
  processing: "사진 확대 중",
  writing: "초안 작성 중",
  awaiting_ai: "직접 작성 가능",
  ready: "초안 준비 완료",
  duplicate: "중복 감지",
  preparing_editor: "편집기 준비 중",
  manual_completion: "공식 화면에서 완료",
  publishing: "발행 중",
  verification_required: "기존 글 확인 필요",
  published: "발행 확인 완료",
  failed: "작업 중단",
};
class ApiFailure extends Error {
  job: Job | null;
  constructor(message: string, job?: Job) {
    super(message);
    this.job = job || null;
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, options);
  const result = await response.json();
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("다시 접속해 주세요.");
  }
  if (!response.ok)
    throw new ApiFailure(
      result.error || "작업을 완료하지 못했습니다.",
      result.job,
    );
  return result;
}
export const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: body ? { "content-type": "application/json" } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

export default function Dashboard() {
  const [tab, setTab] = useState<"work" | "naver" | "history">("work");
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const selectedRef = useRef<string | null>(null);
  function chooseJob(id: string) {
    selectedRef.current = id;
    setSelected(id);
    setDetail(null);
  }
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [location, setLocation] = useState("");
  const [salon, setSalon] = useState("");
  const [treatments, setTreatments] = useState("");
  const [rights, setRights] = useState(false);
  const [auto, setAuto] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const requestId = useRef<string | null>(null);
  async function refresh(id = selectedRef.current) {
    const [status, record] = await Promise.all([
      api<Readiness>("/status"),
      api<{ jobs: Job[] }>("/jobs"),
    ]);
    setReadiness(status);
    setJobs(record.jobs);
    if (id) {
      const next = await api<Detail>(`/jobs/${id}`);
      if (selectedRef.current === id) setDetail(next);
    }
  }
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (!cancelled)
        void refresh(selected).catch((error: Error) => {
          if (!cancelled) {
            setMessage(error.message);
            setError(true);
          }
        });
    };
    load();
    const timer = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selected]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      await action();
      await refresh();
      return true;
    } catch (error) {
      setError(true);
      if (error instanceof ApiFailure && error.job) {
        chooseJob(error.job.id);
        try {
          setDetail(await api<Detail>(`/jobs/${error.job.id}`));
        } catch {}
      }
      setMessage(
        error instanceof Error ? error.message : "작업을 완료하지 못했습니다.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      requestId.current ||= crypto.randomUUID();
      const body = new FormData();
      body.set("requestId", requestId.current);
      body.set(
        "input",
        JSON.stringify({
          sourceUrl,
          caption,
          location,
          salon,
          confirmedTreatments: treatments,
          rightsConfirmed: rights,
          mode: auto ? "publish" : "draft",
        }),
      );
      for (const file of Array.from(upload.current?.files || []))
        body.append("images", file);
      const data = await api<{ job: Job }>("/jobs", { method: "POST", body });
      chooseJob(data.job.id);
      setDetail(await api<Detail>(`/jobs/${data.job.id}`));
      requestId.current = null;
      setSourceUrl("");
      setCaption("");
      setRights(false);
      if (upload.current) upload.current.value = "";
      setMessage(
        "작업을 시작했습니다. 진행 상태와 준비된 사진을 아래에서 확인하세요.",
      );
    });
  }
  const connection = readiness?.connection;
  const activeBlog = connection?.blogs.find(
    (blog) => blog.id === connection.selectedBlog,
  );
  async function selectBlog(blogId: string, categoryId: string) {
    await run(async () => {
      await api("/naver/select", post({ blogId, categoryId }));
    });
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-icon">b.</span>
          <span>
            블로그 스튜디오<small>NAVER BLOG AUTO</small>
          </span>
        </a>
        <div className="workspace">
          MY WORKSPACE<span>사진에서 시작하는 블로그</span>
        </div>
        <nav aria-label="관리 메뉴">
          {(
            [
              ["work", "콘텐츠 만들기", "▦"],
              ["naver", "네이버 연결", "◎"],
              ["history", "작업 기록", "↗"],
            ] as const
          ).map(([key, title, icon]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              <span aria-hidden="true">{icon}</span>
              {title}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="dot" />
          관리자 전용
          <p>비밀번호를 저장하지 않고 네이버 공식 화면에서 연결합니다.</p>
        </div>
        <div className="sidebar-footer">
          <button
            className="link-button"
            onClick={() =>
              void run(async () => {
                await api("/auth/logout", post());
                window.location.assign("/login");
              })
            }
          >
            사이트 로그아웃
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            내 스튜디오 /{" "}
            {tab === "work"
              ? "콘텐츠 만들기"
              : tab === "naver"
                ? "네이버 연결"
                : "작업 기록"}
          </span>
          <span className="version">비공개 워크스페이스</span>
        </header>
        <div className="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">PHOTOS TO YOUR NEXT STORY</p>
              <h1>
                {tab === "work"
                  ? "새로운 블로그 이야기"
                  : tab === "naver"
                    ? "네이버 연결"
                    : "작업 기록"}
              </h1>
              <p>
                {tab === "work"
                  ? "사진을 준비하고, 사실에 맞는 글을 확인하세요."
                  : tab === "naver"
                    ? "아이디와 비밀번호는 공식 네이버 화면에서만 입력합니다."
                    : "중단된 작업도 기록을 유지하며 안전하게 이어갑니다."}
              </p>
            </div>
            <span className="status-pill">
              <span className="dot" />
              {connection?.connected ? "네이버 연결됨" : "네이버 연결 전"}
            </span>
          </div>
          {message && (
            <div
              className={`notice ${error ? "error" : "success"}`}
              role={error ? "alert" : "status"}
            >
              {message}
            </div>
          )}
          {readiness && (
            <div className="capability-row">
              <span>
                {readiness.aiConnected
                  ? "AI 설정 등록됨"
                  : "AI 연결 대기 · 직접 작성 가능"}
              </span>
              <span>
                {readiness.automaticPublishingEnabled
                  ? "자동 발행 사용 가능"
                  : "자동 발행 제한 · 공식 화면에서 수동 완료"}
              </span>
            </div>
          )}
          {tab === "naver" && (
            <>
              <section className="card">
                <div className="section-heading">
                  <div>
                    <h2>내 네이버 계정</h2>
                    <p>로그인 후 본인 블로그와 카테고리를 확인합니다.</p>
                  </div>
                  <span className="badge">
                    {connection?.connected ? "연결됨" : "연결 전"}
                  </span>
                </div>
                <div className="info-box">
                  아래 공식 네이버 화면을 열어 직접 로그인해 주세요. 인증 문자나
                  보안 확인이 나오면 그대로 완료합니다. 보안 절차를 우회하지
                  않으며, 로그인 세션만 암호화해 보관합니다.
                </div>
                <div className="button-row">
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api("/naver/login", post());
                        setMessage(
                          "공식 네이버 화면을 열었습니다. 화면에서 로그인한 뒤 로그인 완료 확인을 누르세요.",
                        );
                      })
                    }
                  >
                    공식 네이버 로그인 열기
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || !connection?.browserOpen}
                    onClick={() =>
                      void run(async () => {
                        await api("/naver/confirm", post());
                        setMessage("본인 블로그와 카테고리를 불러왔습니다.");
                      })
                    }
                  >
                    로그인 완료 확인
                  </button>
                  <button
                    className="link-button"
                    disabled={busy || !connection?.browserOpen}
                    onClick={() =>
                      void run(async () => {
                        await api("/naver/logout", post());
                      })
                    }
                  >
                    연결 해제
                  </button>
                </div>
              </section>
              {connection?.browserOpen && (
                <RemoteBrowser
                  officialUrl={connection.officialUrl}
                  onError={(text) => {
                    setError(true);
                    setMessage(text);
                  }}
                />
              )}
              <section className="card">
                <h2>블로그와 카테고리</h2>
                {connection?.blogs.length ? (
                  <div className="account-form selection-form">
                    <div>
                      <label htmlFor="blog-select">블로그 선택</label>
                      <select
                        id="blog-select"
                        value={connection.selectedBlog || ""}
                        disabled={busy}
                        onChange={(event) => {
                          const blog = connection.blogs.find(
                            (item) => item.id === event.target.value,
                          )!;
                          void selectBlog(blog.id, blog.categories[0].id);
                        }}
                      >
                        {connection.blogs.map((blog) => (
                          <option value={blog.id} key={blog.id}>
                            {blog.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="category-select">게시판 선택</label>
                      <select
                        id="category-select"
                        value={connection.selectedCategory || ""}
                        disabled={busy}
                        onChange={(event) =>
                          void selectBlog(
                            connection.selectedBlog!,
                            event.target.value,
                          )
                        }
                      >
                        {activeBlog?.categories.map((category) => (
                          <option value={category.id} key={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <p className="hint">
                    공식 로그인을 완료하면 이곳에 본인 블로그와 카테고리가
                    표시됩니다.
                  </p>
                )}
              </section>
              <section className="card">
                <h2>기존 게시물 비교</h2>
                <p className="hint">{connection?.history.message}</p>
                <button
                  className="secondary-button"
                  disabled={busy || !connection?.connected}
                  onClick={() =>
                    void run(async () => {
                      await api("/naver/history", post());
                      setMessage(
                        "기존 글 비교를 시작했습니다. 전체 기록을 확인하지 못하면 자동 발행하지 않습니다.",
                      );
                    })
                  }
                >
                  기존 네이버 발행 기록 비교
                </button>
              </section>
            </>
          )}
          {tab === "work" && (
            <>
              <section className="card">
                <div className="section-heading">
                  <div>
                    <span className="step">01 / START A STORY</span>
                    <h2>사진과 콘텐츠 준비</h2>
                    <p>링크를 입력하거나 원본 사진을 직접 올려 주세요.</p>
                  </div>
                  <span className="badge neutral">초안 모드 기본</span>
                </div>
                {!connection?.connected && (
                  <p className="setup-note">
                    <button onClick={() => setTab("naver")}>
                      네이버 계정을 먼저 연결
                    </button>
                    하면 카테고리에 맞춰 준비할 수 있습니다. 연결 전에는 사진과
                    초안만 준비할 수 있습니다.
                  </p>
                )}
                <form onSubmit={create} className="account-form">
                  <div className="full">
                    <label htmlFor="source-url">인스타그램 URL</label>
                    <input
                      id="source-url"
                      type="url"
                      value={sourceUrl}
                      maxLength={2048}
                      onChange={(event) => {
                        setSourceUrl(event.target.value);
                        requestId.current = null;
                      }}
                      placeholder="https://www.instagram.com/p/..."
                    />
                    <p className="hint">
                      SaveFrom을 우선 시도합니다. 보안 확인·전체 사진 누락
                      가능성이 있으면 직접 업로드로 안내합니다.
                    </p>
                  </div>
                  <div className="full">
                    <label htmlFor="photos-upload">
                      원본 사진 직접 업로드 (여러 장 가능)
                    </label>
                    <input
                      ref={upload}
                      id="photos-upload"
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      onChange={() => {
                        requestId.current = null;
                      }}
                    />
                    <p className="hint">
                      JPG · PNG · WebP, 각 10MB 이하 · 최대 20장 · 총 80MB 이하.
                      업로드 순서대로 글에 배치합니다.
                    </p>
                  </div>
                  <div className="full">
                    <label htmlFor="caption">
                      인스타그램 본문 또는 사진 설명
                    </label>
                    <textarea
                      id="caption"
                      value={caption}
                      maxLength={8000}
                      rows={4}
                      onChange={(event) => setCaption(event.target.value)}
                      placeholder="원래 게시물 본문을 붙여 넣거나 사진에 대해 확인한 내용을 적어 주세요."
                    />
                  </div>
                  <div>
                    <label htmlFor="salon">매장명 (선택)</label>
                    <input
                      id="salon"
                      value={salon}
                      maxLength={100}
                      onChange={(event) => setSalon(event.target.value)}
                      placeholder="확인된 매장 이름"
                    />
                  </div>
                  <div>
                    <label htmlFor="location">지역 키워드 (선택)</label>
                    <input
                      id="location"
                      value={location}
                      maxLength={100}
                      onChange={(event) => setLocation(event.target.value)}
                      placeholder="예: 서울 성수동"
                    />
                  </div>
                  <div className="full">
                    <label htmlFor="treatments">확인된 시술 사실 (선택)</label>
                    <textarea
                      id="treatments"
                      value={treatments}
                      maxLength={2000}
                      rows={2}
                      onChange={(event) => setTreatments(event.target.value)}
                      placeholder="실제로 확인한 시술만 적어 주세요. 모르면 비워 두세요."
                    />
                  </div>
                  <label className="check-label full">
                    <input
                      type="checkbox"
                      required
                      checked={rights}
                      onChange={(event) => setRights(event.target.checked)}
                    />
                    제가 소유하거나 사용 허락을 받은 사진이며, 입력한 시술
                    정보는 확인한 사실입니다.
                  </label>
                  <label className="check-label full">
                    <input
                      type="checkbox"
                      checked={auto}
                      disabled={!readiness?.automaticPublishingEnabled}
                      onChange={(event) => setAuto(event.target.checked)}
                    />
                    자동 발행을 명시적으로 활성화합니다.{" "}
                    {readiness?.automaticPublishingEnabled
                      ? ""
                      : "(실제 네이버 검증 전에는 사용할 수 없습니다.)"}
                  </label>
                  <div className="form-footer full">
                    <span>
                      사진 2배 확대 → 중복 검사 → 글 초안 → 확인 및 완료
                    </span>
                    <button
                      type="submit"
                      disabled={busy || !readiness || !rights}
                    >
                      {busy ? "작업 등록 중…" : "자동화 시작"}
                    </button>
                  </div>
                </form>
              </section>
              {detail && (
                <JobPanel
                  key={detail.job.id}
                  detail={detail}
                  busy={busy}
                  publishingEnabled={Boolean(
                    readiness?.automaticPublishingEnabled,
                  )}
                  run={run}
                  selectJob={chooseJob}
                  showNaver={() => setTab("naver")}
                />
              )}
            </>
          )}
          {(tab === "history" || tab === "work") && (
            <section className="card content-list">
              <div className="section-heading">
                <div>
                  <h2>
                    작업 보관함 <span className="count">{jobs.length}</span>
                  </h2>
                  <p>
                    최근 100개 작업을 표시합니다. 동일 URL은 새 작업으로
                    재등록하지 않습니다.
                  </p>
                </div>
              </div>
              {!jobs.length ? (
                <div className="empty-state">
                  <h3>첫 번째 이야기를 준비해 보세요</h3>
                  <p>사진을 올리면 확대 결과와 작성 상태가 표시됩니다.</p>
                </div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>콘텐츠</th>
                        <th>상태</th>
                        <th>카테고리</th>
                        <th>발행 글</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((job) => (
                        <tr key={job.id}>
                          <td>
                            <button
                              className="link-button"
                              onClick={() => {
                                chooseJob(job.id);
                                setTab("work");
                              }}
                            >
                              {job.draft?.title ||
                                (job.source_url.startsWith("upload:")
                                  ? "직접 업로드한 사진"
                                  : job.source_url)}
                            </button>
                          </td>
                          <td>
                            <span
                              className={`badge ${job.status === "published" ? "success-badge" : "neutral"}`}
                            >
                              {labels[job.status]}
                            </span>
                          </td>
                          <td>{job.category_name}</td>
                          <td>
                            {job.published_url ? (
                              <a
                                href={job.published_url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                블로그 바로가기 ↗
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          <footer className="page-footer">
            NAVER BLOG AUTO
            <span>
              확인되지 않은 사실은 쓰지 않고, 불명확한 발행은 다시 실행하지
              않습니다.
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
function JobPanel({
  detail,
  busy,
  publishingEnabled,
  run,
  selectJob,
  showNaver,
}: {
  detail: Detail;
  busy: boolean;
  publishingEnabled: boolean;
  run: (action: () => Promise<void>) => Promise<boolean>;
  selectJob: (id: string) => void;
  showNaver: () => void;
}) {
  const { job, assets } = detail;
  const [publishedUrl, setPublishedUrl] = useState("");
  const [allPhotos, setAllPhotos] = useState(false);
  const [uploadRights, setUploadRights] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const progressing = [
    "uploading",
    "queued",
    "extracting",
    "processing",
    "writing",
    "publishing",
    "preparing_editor",
  ].includes(job.status);
  return (
    <section className="card job-panel">
      <div className="section-heading">
        <div>
          <span className="step">02 / YOUR STORY</span>
          <h2>작업 진행 상태</h2>
        </div>
        <span className="badge neutral">{labels[job.status]}</span>
      </div>
      <div className="info-box" role="status">
        {job.message || "작업을 준비하고 있습니다."}
      </div>
      <p className="hint">기존 블로그 비교: {detail.history.message}</p>
      {progressing && (
        <p className="processing-indicator">
          작업을 진행 중입니다. 이 페이지를 닫아도 기록은 유지됩니다.
        </p>
      )}
      {!!assets.length && (
        <div className="photo-grid">
          {assets.map((asset) => (
            <figure key={asset.id}>
              <img
                src={asset.url}
                alt={`사진 ${asset.ordinal + 1}`}
                loading="lazy"
              />
              <figcaption>
                사진 {asset.ordinal + 1} ·{" "}
                {asset.upscaled
                  ? `${asset.width * 2} × ${asset.height * 2} · 2배 확대`
                  : `${asset.width} × ${asset.height} · 원본`}
              </figcaption>
              <a
                className="link-button"
                href={`${asset.url}?variant=original`}
                target="_blank"
                rel="noreferrer"
              >
                원본 보기
              </a>
            </figure>
          ))}
        </div>
      )}
      {job.status === "waiting_images" && (
        <div className="fallback-panel">
          <h3>원본 사진으로 이어가기</h3>
          {!!assets.length && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={allPhotos}
                  onChange={(event) => setAllPhotos(event.target.checked)}
                />
                원본 게시물의 모든 사진이 순서대로 포함됐는지 확인했습니다.
              </label>
              <button
                className="secondary-button"
                disabled={busy || !allPhotos}
                onClick={() =>
                  void run(async () => {
                    await api(
                      `/jobs/${job.id}/confirm-photos`,
                      post({ allPhotosConfirmed: true }),
                    );
                  })
                }
              >
                이 사진으로 계속
              </button>
            </>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const body = new FormData();
                for (const file of Array.from(uploadRef.current?.files || []))
                  body.append("images", file);
                body.set("rightsConfirmed", String(uploadRights));
                await api(`/jobs/${job.id}/upload`, { method: "POST", body });
              });
            }}
          >
            <label htmlFor={`missing-photos-${job.id}`}>
              원본 사진 추가 업로드
            </label>
            <input
              ref={uploadRef}
              id={`missing-photos-${job.id}`}
              type="file"
              multiple
              required
              accept="image/jpeg,image/png,image/webp"
            />
            <label className="check-label">
              <input
                type="checkbox"
                required
                checked={uploadRights}
                onChange={(event) => setUploadRights(event.target.checked)}
              />
              사용 권한이 있는 전체 원본 사진을 준비했습니다.
            </label>
            <button className="primary-button" disabled={busy || !uploadRights}>
              사진 업로드 후 계속
            </button>
          </form>
        </div>
      )}
      {job.duplicate_matches.length > 0 && (
        <div className="duplicate-list">
          <h3>중복 검사 결과</h3>
          {job.duplicate_matches.map((match, index) => (
            <div key={index}>
              <p>{match.reason}</p>
              {match.postUrl && (
                <a
                  className="link-button"
                  href={match.postUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  기존 네이버 게시물 보기 ↗
                </a>
              )}
              {match.jobId && (
                <button
                  className="link-button"
                  onClick={() => selectJob(match.jobId!)}
                >
                  사진을 사용한 기존 작업 보기
                </button>
              )}
            </div>
          ))}
          <p className="hint">
            유사도 비교는 크기 변경을 고려하지만 모든 크롭·필터를 판별하지는
            못합니다. 오탐 가능성이 있는 결과도 자동 재발행하지 않습니다.
          </p>
        </div>
      )}
      {["awaiting_ai", "failed"].includes(job.status) && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api(`/jobs/${job.id}/retry`, post());
            })
          }
        >
          같은 작업 재시도
        </button>
      )}
      {[
        "awaiting_ai",
        "failed",
        "ready",
        "manual_completion",
        "verification_required",
        "published",
      ].includes(job.status) &&
        assets.every((asset) => asset.upscaled) &&
        !!assets.length && (
          <DraftPreview
            detail={detail}
            busy={busy}
            onSave={(draft) =>
              run(async () => {
                await api(`/jobs/${job.id}/draft`, post(draft));
              })
            }
          />
        )}
      {job.draft && (
        <div className="button-row action-bar">
          <a className="primary-button" href={`/api/jobs/${job.id}/export`}>
            본문과 확대 사진 다운로드
          </a>
          {["ready", "manual_completion"].includes(job.status) && (
            <>
              <button
                className="secondary-button"
                disabled={busy || !job.blog_id}
                onClick={() =>
                  void run(async () => {
                    await api(`/jobs/${job.id}/editor`, post());
                    showNaver();
                  })
                }
              >
                네이버 공식 편집기에서 완료
              </button>
              <button
                className="secondary-button"
                disabled={busy || !publishingEnabled}
                onClick={() =>
                  void run(async () => {
                    await api(
                      `/jobs/${job.id}/publish`,
                      post({ automaticPublishingEnabled: true }),
                    );
                  })
                }
              >
                자동 발행
              </button>
            </>
          )}
        </div>
      )}
      {["ready", "manual_completion", "verification_required"].includes(
        job.status,
      ) &&
        job.draft && (
          <form
            className="publication-confirm"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api(
                  `/jobs/${job.id}/confirm-published`,
                  post({ url: publishedUrl }),
                );
              });
            }}
          >
            <label htmlFor={`published-url-${job.id}`}>
              수동 완료 후 실제 네이버 게시물 URL
            </label>
            <input
              id={`published-url-${job.id}`}
              type="url"
              required
              value={publishedUrl}
              onChange={(event) => setPublishedUrl(event.target.value)}
              placeholder="https://blog.naver.com/내블로그/게시물번호"
            />
            <p className="hint">
              네이버에 연결된 상태에서 제목·본문·사진을 조회해 발행 결과를
              확인합니다. 확인 전에는 같은 글을 다시 발행하지 마세요.
            </p>
            <button className="secondary-button" disabled={busy}>
              기존 발행 결과 확인
            </button>
          </form>
        )}
      {job.published_url && (
        <a
          className="primary-button"
          href={job.published_url}
          target="_blank"
          rel="noreferrer"
        >
          발행된 블로그 바로가기 ↗
        </a>
      )}
      <details className="event-log">
        <summary>작업 기록 확인</summary>
        <ol>
          {detail.events.map((event, index) => (
            <li key={index}>
              <span>
                {new Date(event.created_at).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })}
              </span>
              <p>{event.message}</p>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
