import { NextResponse, type NextRequest } from "next/server";
import { workerRequest, ownerCookie } from "@/lib/server/gateway";
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (
    path === "/login" ||
    path === "/api/health" ||
    ["/api/auth/login", "/api/auth/status"].includes(path)
  )
    return NextResponse.next();
  let authenticated = false;
  if (ownerCookie(request))
    try {
      authenticated = (await workerRequest(request, "/auth/check")).ok;
    } catch {}
  if (authenticated) return NextResponse.next();
  if (path.startsWith("/api/"))
    return NextResponse.json(
      { error: "관리자 로그인이 필요합니다." },
      { status: 401 },
    );
  return NextResponse.redirect(
    new URL(
      "/login",
      process.env.APP_PUBLIC_URL ||
        process.env.RENDER_EXTERNAL_URL ||
        request.url,
    ),
  );
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico).*)"],
};
