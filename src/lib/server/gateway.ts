import { NextResponse } from "next/server";

export const OWNER_COOKIE = "blog_owner_session";
export function ownerCookie(request: Request): string | null {
  const entry = request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${OWNER_COOKIE}=`));
  const value = entry?.slice(OWNER_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function sameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const url = new URL(request.url);
  const configured =
    process.env.APP_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (process.env.NODE_ENV === "production" && !configured) return false;
  const expected = configured
    ? new URL(configured).origin
    : `${url.protocol}//${request.headers.get("host") || url.host}`;
  return (
    !request.headers.get("origin") || request.headers.get("origin") === expected
  );
}
export function workerOrigin(): string {
  const value = process.env.WORKER_URL;
  if (!value || !process.env.WORKER_AUTH_TOKEN)
    throw new Error("WORKER_SETUP_REQUIRED");
  const url = new URL(value.includes("://") ? value : `http://${value}`);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("WORKER_SETUP_REQUIRED");
  return url.origin;
}
export async function workerRequest(
  request: Request,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const headers = new Headers(options?.headers);
  headers.set("authorization", `Bearer ${process.env.WORKER_AUTH_TOKEN}`);
  const session = ownerCookie(request);
  if (session) headers.set("x-owner-session", session);
  return fetch(`${workerOrigin()}${path}`, {
    ...options,
    headers,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(150_000),
  });
}
export function unavailable() {
  return NextResponse.json(
    {
      error:
        "사이트 준비 중입니다. 관리자 연결을 완료한 뒤 다시 이용해 주세요.",
    },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
export async function forward(request: Request): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request))
    return NextResponse.json(
      { error: "허용되지 않은 요청입니다." },
      { status: 403 },
    );
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "") + url.search;
  if (path.startsWith("/auth/"))
    return NextResponse.json(
      { error: "지원하지 않는 요청입니다." },
      { status: 404 },
    );
  try {
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const length = request.headers.get("content-length");
    if (length) headers.set("content-length", length);
    const options: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
    };
    if (!["GET", "HEAD"].includes(request.method)) {
      options.body = request.body;
      options.duplex = "half";
    }
    const response = await workerRequest(request, path, options);
    const safeHeaders = new Headers();
    for (const name of [
      "content-type",
      "content-disposition",
      "cache-control",
      "x-content-type-options",
    ])
      if (response.headers.has(name))
        safeHeaders.set(name, response.headers.get(name)!);
    safeHeaders.set("cache-control", "private, no-store");
    return new Response(response.body, {
      status: response.status,
      headers: safeHeaders,
    });
  } catch {
    return unavailable();
  }
}
