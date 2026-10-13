"use client";
import { useEffect, useState, type FormEvent } from "react";
export default function Login() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/auth/status")
      .then((response) => response.json())
      .then((data) => {
        if (data.authenticated) window.location.replace("/");
        else setConfigured(data.configured);
      })
      .catch(() => setConfigured(false));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      setPassword("");
      if (!response.ok) throw new Error(data.error);
      window.location.replace("/");
    } catch (error) {
      setError(error instanceof Error ? error.message : "접속하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="card login-card">
        <span className="brand-icon">b.</span>
        <p className="eyebrow">YOUR PRIVATE BLOG STUDIO</p>
        <h1>블로그 스튜디오</h1>
        <p>
          사진과 로그인 세션을 보호하기 위해
          <br />
          관리자 전용으로 접속합니다.
        </p>
        {configured === false ? (
          <div className="info-box">
            사이트 준비 중입니다. 관리자 연결이 끝나면 이 화면에서 바로 이용할
            수 있습니다.
          </div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="owner-password">사이트 접속 비밀번호</label>
            <input
              id="owner-password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={configured === null || busy}
            />
            <p className="hint">
              네이버 비밀번호가 아닌 이 사이트의 접속 비밀번호입니다.
            </p>
            <button
              className="primary-button"
              disabled={configured === null || busy}
            >
              {busy ? "확인 중…" : "내 스튜디오 열기"}
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <p className="hint">
          네이버 비밀번호는 연결 후 공식 네이버 화면에서만 입력합니다.
        </p>
      </section>
    </main>
  );
}
