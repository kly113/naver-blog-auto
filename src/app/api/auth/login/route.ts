import { NextResponse } from "next/server";
import {
  OWNER_COOKIE,
  sameOrigin,
  workerRequest,
  unavailable,
} from "@/lib/server/gateway";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "허용되지 않은 요청입니다." },
      { status: 403 },
    );
  try {
    const bytes = await request.text();
    if (bytes.length > 4096)
      return NextResponse.json(
        { error: "입력을 확인하세요." },
        { status: 400 },
      );
    const response = await workerRequest(request, "/auth/login", {
      method: "POST",
      body: bytes,
      headers: { "content-type": "application/json" },
    });
    const data = await response.json();
    if (!response.ok)
      return NextResponse.json(
        { error: data.error },
        { status: response.status },
      );
    const result = NextResponse.json({ ok: true });
    result.cookies.set(OWNER_COOKIE, data.session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
    return result;
  } catch {
    return unavailable();
  }
}
