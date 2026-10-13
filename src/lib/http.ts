import { NextResponse } from "next/server";

// This foundation has no authentication. Serve it locally; reject cross-origin mutations.
export function mutationGuard(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  // Next.js may use its bind address in request.url; Host retains the browser-facing address.
  const url = new URL(request.url);
  const expectedOrigin = `${url.protocol}//${request.headers.get("host") || url.host}`;
  if (origin && origin !== expectedOrigin)
    return NextResponse.json(
      { error: "허용되지 않은 요청입니다." },
      { status: 403 },
    );
  return null;
}
export function errorResponse(error: unknown) {
  if (error instanceof SyntaxError)
    return NextResponse.json(
      { error: "요청 형식을 확인하세요." },
      { status: 400 },
    );
  console.error(
    "Local storage operation failed:",
    error instanceof Error ? error.name : "unknown",
  );
  return NextResponse.json(
    { error: "저장에 실패했습니다. 서버 로그를 확인하세요." },
    { status: 500 },
  );
}
