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
    const response = await workerRequest(request, "/auth/logout", {
      method: "POST",
    });
    if (!response.ok && response.status !== 401) return unavailable();
    const result = NextResponse.json({ ok: true });
    result.cookies.set(OWNER_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
    return result;
  } catch {
    return unavailable();
  }
}
