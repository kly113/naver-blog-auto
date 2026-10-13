"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Profile, Post, ImageRecord } from "@/lib/db";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "요청에 실패했습니다.");
  return result;
}

export default function Dashboard() {
  const [tab, setTab] = useState<"content" | "account">("content");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [url, setUrl] = useState("");
  const [blogId, setBlogId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [categoryText, setCategoryText] = useState("일상, 여행, 맛집");
  const [selectedCategory, setSelectedCategory] = useState("일상");
  const categories = [
    ...new Set(
      categoryText
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];

  useEffect(() => {
    Promise.all([
      request<{ profile: Profile | null }>("/api/profile"),
      request<{ posts: Post[] }>("/api/posts"),
      request<{ images: ImageRecord[] }>("/api/images"),
    ])
      .then(([account, content, assets]) => {
        setProfile(account.profile);
        setPosts(content.posts);
        setImages(assets.images);
        if (account.profile) {
          setBlogId(account.profile.blogId);
          setDisplayName(account.profile.displayName);
          setCategoryText(account.profile.categories.join(", "));
          setSelectedCategory(account.profile.selectedCategory);
        }
      })
      .catch((error: Error) => {
        setFailed(true);
        setMessage(error.message);
      })
      .finally(() => setLoading(false));
  }, []);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      await action();
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : "요청에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      const result = await request<{ profile: Profile }>("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blogId,
          displayName,
          categories,
          selectedCategory,
        }),
      });
      setProfile(result.profile);
      setMessage(
        "블로그 설정을 저장했습니다. 실제 네이버 로그인은 다음 단계에서 진행합니다.",
      );
    });
  }
  function addPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      const result = await request<{ post: Post }>("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      setPosts((items) => [result.post, ...items].slice(0, 100));
      setUrl("");
      setMessage(
        "콘텐츠를 등록했습니다. 수집과 글 작성은 다음 단계에서 지원합니다.",
      );
    });
  }
  function uploadImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    void perform(async () => {
      const result = await request<{ images: ImageRecord[] }>("/api/images", {
        method: "POST",
        body,
      });
      setImages(result.images);
      form.reset();
      setMessage("이미지 중복 검사 정보를 등록했습니다.");
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
          MY WORKSPACE<span>개인 콘텐츠 관리</span>
        </div>
        <nav aria-label="관리 메뉴">
          <button
            className={tab === "content" ? "active" : ""}
            onClick={() => setTab("content")}
          >
            <span aria-hidden="true">▦</span> 콘텐츠 관리
          </button>
          <button
            className={tab === "account" ? "active" : ""}
            onClick={() => setTab("account")}
          >
            <span aria-hidden="true">◎</span> 블로그 연결
          </button>
        </nav>
        <div className="sidebar-note">
          <span className="dot" />
          개발 미리보기
          <p>
            등록한 콘텐츠는 초안으로 보관됩니다. 자동 발행은 아직 실행되지
            않습니다.
          </p>
        </div>
        <div className="sidebar-footer">
          사진에서 시작하는
          <br />
          나만의 블로그 이야기.
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            워크스페이스 <span className="separator">/</span>{" "}
            {tab === "content" ? "콘텐츠 관리" : "블로그 연결"}
          </span>
          <span className="version">v0.1 · 개발 단계</span>
        </header>
        <div className="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR CONTENT, ONE PLACE</p>
              <h1>{tab === "content" ? "콘텐츠 관리" : "블로그 연결"}</h1>
              <p>
                {tab === "content"
                  ? "좋은 사진을 모으고, 다음 블로그 이야기를 준비하세요."
                  : "글을 보낼 블로그와 카테고리를 먼저 등록하세요."}
              </p>
            </div>
            <span className="status-pill">
              <span className="dot" />
              로컬 워크스페이스
            </span>
          </div>
          {message && (
            <div
              role={failed ? "alert" : "status"}
              className={`notice ${failed ? "error" : "success"}`}
            >
              {message}
            </div>
          )}
          {loading ? (
            <p role="status">워크스페이스를 불러오는 중입니다…</p>
          ) : (
            <>
              <div className="stats">
                <div>
                  <span>등록한 콘텐츠</span>
                  <strong>
                    {posts.length}
                    <small>개</small>
                  </strong>
                  <p>최근 100개 기준</p>
                </div>
                <div>
                  <span>검사한 이미지</span>
                  <strong>
                    {images.length}
                    <small>장</small>
                  </strong>
                  <p>중복 없이 등록된 이미지 · 최근 100개</p>
                </div>
                <div>
                  <span>네이버 연결</span>
                  <strong className="text-stat">로그인 대기</strong>
                  <p>
                    {profile
                      ? `${profile.displayName} · 설정 등록됨`
                      : "블로그 설정을 등록해 주세요"}
                  </p>
                </div>
              </div>
              {tab === "account" ? (
                <section className="card account-card">
                  <div className="section-heading">
                    <div>
                      <h2>네이버 블로그 설정</h2>
                      <p>비밀번호 없이 블로그 정보만 저장합니다.</p>
                    </div>
                    <span className="badge">미연결</span>
                  </div>
                  <div className="info-box">
                    현재는 연결 준비 단계입니다. 카테고리는 직접 등록하며, 실제
                    로그인과 네이버 카테고리 조회는 다음 단계에서 지원합니다.
                  </div>
                  <form onSubmit={saveAccount} className="account-form">
                    <label>
                      블로그 이름
                      <input
                        required
                        maxLength={50}
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder="예: 나의 여행 기록"
                      />
                    </label>
                    <label>
                      블로그 ID
                      <input
                        required
                        minLength={2}
                        maxLength={50}
                        pattern="[a-zA-Z0-9_-]+"
                        value={blogId}
                        onChange={(event) => setBlogId(event.target.value)}
                        placeholder="blog.naver.com/ 뒤의 ID"
                      />
                    </label>
                    <label className="full">
                      카테고리 직접 등록
                      <input
                        required
                        value={categoryText}
                        onChange={(event) => {
                          const text = event.target.value;
                          setCategoryText(text);
                          const next = text
                            .split(/[,\n]/)
                            .map((item) => item.trim())
                            .filter(Boolean);
                          if (!next.includes(selectedCategory))
                            setSelectedCategory(next[0] || "");
                        }}
                        placeholder="일상, 여행, 맛집"
                      />
                      <small>
                        쉼표로 구분해 입력하세요. 네이버에 실제 존재하는
                        카테고리와 이후 연결합니다.
                      </small>
                    </label>
                    <div className="full">
                      <label htmlFor="selected-category">기본 카테고리</label>
                      <select
                        id="selected-category"
                        required
                        value={selectedCategory}
                        onChange={(event) =>
                          setSelectedCategory(event.target.value)
                        }
                      >
                        {categories.map((category) => (
                          <option key={category}>{category}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-footer full">
                      <span>로그인 비밀번호와 API 키는 필요하지 않습니다.</span>
                      <button disabled={busy} type="submit">
                        {busy ? "저장 중…" : "블로그 설정 저장"}
                      </button>
                    </div>
                  </form>
                </section>
              ) : (
                <>
                  <div className="input-grid">
                    <section className="card">
                      <div className="section-heading">
                        <div>
                          <span className="step">01 / SOURCE</span>
                          <h2>인스타그램 콘텐츠 추가</h2>
                          <p>게시물 또는 릴스 링크를 등록하세요.</p>
                        </div>
                        <span className="source-icon">↗</span>
                      </div>
                      {!profile && (
                        <p className="setup-note">
                          먼저{" "}
                          <button onClick={() => setTab("account")}>
                            블로그 설정을 등록
                          </button>
                          하세요.
                        </p>
                      )}
                      <form onSubmit={addPost}>
                        <label htmlFor="instagram-url">인스타그램 URL</label>
                        <input
                          id="instagram-url"
                          type="url"
                          required
                          value={url}
                          onChange={(event) => setUrl(event.target.value)}
                          placeholder="https://www.instagram.com/p/..."
                        />
                        <div className="form-footer">
                          <span>
                            {profile
                              ? `기본 카테고리: ${profile.selectedCategory}`
                              : "게시물·릴스 링크 지원"}
                          </span>
                          <button disabled={busy || !profile} type="submit">
                            콘텐츠 등록 <span>＋</span>
                          </button>
                        </div>
                      </form>
                    </section>
                    <section className="card">
                      <div className="section-heading">
                        <div>
                          <span className="step">02 / IMAGE CHECK</span>
                          <h2>이미지 중복 검사</h2>
                          <p>등록한 이미지와 같은 사진인지 확인합니다.</p>
                        </div>
                        <span className="source-icon">▧</span>
                      </div>
                      <form onSubmit={uploadImage}>
                        <label htmlFor="image">검사할 이미지</label>
                        <input
                          id="image"
                          name="image"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          required
                        />
                        <div className="form-footer">
                          <span>JPG, PNG, WebP · 최대 10MB</span>
                          <button type="submit" disabled={busy}>
                            검사 및 등록
                          </button>
                        </div>
                      </form>
                    </section>
                  </div>
                  <section className="card content-list">
                    <div className="section-heading">
                      <div>
                        <h2>
                          콘텐츠 보관함{" "}
                          <span className="count">{posts.length}</span>
                        </h2>
                        <p>등록한 링크를 저장하고 중복 등록을 방지합니다.</p>
                      </div>
                      <span className="badge neutral">최근 100개</span>
                    </div>
                    {posts.length === 0 ? (
                      <div className="empty-state">
                        <div>↗</div>
                        <h3>첫 번째 이야기를 준비해 보세요</h3>
                        <p>
                          인스타그램 링크를 등록하면 이곳에 콘텐츠가 표시됩니다.
                        </p>
                      </div>
                    ) : (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>콘텐츠 링크</th>
                              <th>카테고리</th>
                              <th>상태</th>
                              <th>등록일</th>
                            </tr>
                          </thead>
                          <tbody>
                            {posts.map((post) => (
                              <tr key={post.id}>
                                <td>
                                  <a
                                    href={post.source_url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {post.source_url}
                                  </a>
                                </td>
                                <td>{post.category}</td>
                                <td>
                                  <span className="badge neutral">초안</span>
                                </td>
                                <td>
                                  {new Date(post.created_at).toLocaleDateString(
                                    "ko-KR",
                                    { timeZone: "Asia/Seoul" },
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                  {images.length > 0 && (
                    <section className="card image-list">
                      <h2>등록한 이미지</h2>
                      <ul>
                        {images.slice(0, 10).map((item) => (
                          <li key={item.id}>
                            <span>{item.original_name}</span>
                            <small>
                              {item.width} × {item.height} · 중복 검사 완료
                            </small>
                          </li>
                        ))}
                      </ul>
                      <p className="hint">
                        파일 내용과 디코딩된 픽셀을 비교합니다. 크기
                        변경·크롭·재압축된 사진의 유사도 검사는 다음 단계입니다.
                        원본 파일은 보관하지 않습니다.
                      </p>
                    </section>
                  )}
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            NAVER BLOG AUTO{" "}
            <span>
              콘텐츠 수집 · AI 글 작성 · 자동 발행은 다음 개발 단계에서
              연결됩니다.
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
