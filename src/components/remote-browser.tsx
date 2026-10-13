"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, post } from "./dashboard";
export default function RemoteBrowser({
  officialUrl,
  onError,
}: {
  officialUrl: string | null;
  onError: (message: string) => void;
}) {
  const [frame, setFrame] = useState(0);
  const [failed, setFailed] = useState(false);
  const screen = useRef<HTMLDivElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const sending = useRef(Promise.resolve());
  useEffect(() => {
    const timer = setInterval(() => setFrame(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  function send(value: unknown) {
    sending.current = sending.current.then(async () => {
      try {
        await api("/naver/action", post(value));
      } catch (error) {
        onError(
          error instanceof Error
            ? error.message
            : "공식 화면을 조작하지 못했습니다.",
        );
      }
    });
  }
  function key(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v")
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      send({ action: "key", key: "Control+a" });
      return;
    }
    if (
      [
        "Enter",
        "Tab",
        "Backspace",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Escape",
        "Home",
        "End",
      ].includes(event.key)
    ) {
      event.preventDefault();
      send({ action: "key", key: event.key });
      return;
    }
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      send({ action: "text", text: event.key });
    }
  }
  return (
    <section className="card remote-card">
      <div className="section-heading">
        <div>
          <h2>공식 네이버 화면</h2>
          <p>
            화면 안을 클릭한 뒤 키보드로 입력하세요. 한글 입력과 붙여넣기를
            지원합니다.
          </p>
        </div>
        <span className="badge neutral">관리자 전용 연결</span>
      </div>
      <div className="official-address">
        {officialUrl || "네이버 화면 로딩 중"}
      </div>
      {failed && (
        <p className="notice error">
          공식 화면을 불러오지 못했습니다. 위의 로그인 버튼으로 다시 시도하세요.
        </p>
      )}
      <div
        ref={screen}
        role="application"
        aria-label="공식 네이버 브라우저 조작 화면"
        tabIndex={0}
        className="remote-screen"
        onWheel={(event) =>
          send({
            action: "scroll",
            delta: Math.max(-900, Math.min(900, event.deltaY)),
          })
        }
      >
        <img
          src={`/api/naver/screen?t=${frame}`}
          alt="공식 네이버 로그인 또는 편집 화면"
          draggable={false}
          onLoad={() => setFailed(false)}
          onError={() => setFailed(true)}
          onClick={(event) => {
            keyboard.current?.focus();
            const bounds = event.currentTarget.getBoundingClientRect();
            send({
              action: "click",
              x: ((event.clientX - bounds.left) * 1365) / bounds.width,
              y: ((event.clientY - bounds.top) * 900) / bounds.height,
            });
          }}
        />
      </div>
      <textarea
        ref={keyboard}
        className="remote-keyboard"
        aria-label="공식 네이버 화면 키보드 입력"
        autoComplete="off"
        spellCheck={false}
        onKeyDown={key}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          if (event.data) send({ action: "text", text: event.data });
          event.currentTarget.value = "";
        }}
        onInput={(event) => {
          if (!composing.current && event.currentTarget.value) {
            send({ action: "text", text: event.currentTarget.value });
            event.currentTarget.value = "";
          }
        }}
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData("text");
          if (text.length > 20000) {
            onError(
              "한 번에 최대 20,000자까지 붙여넣을 수 있습니다. 문단을 나누어 붙여넣으세요.",
            );
            return;
          }
          if (text) send({ action: "text", text });
          event.currentTarget.value = "";
        }}
      />
      <p className="hint">
        화면은 보안 실행 환경의 실제 네이버 페이지입니다. 비밀번호와 입력 기록은
        저장하지 않습니다. 스티커·보안 확인·임시저장은 이 공식 화면에서 직접
        완료할 수 있습니다.
      </p>
    </section>
  );
}
