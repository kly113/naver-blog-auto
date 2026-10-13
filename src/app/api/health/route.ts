import { NextResponse } from "next/server";
import { workerRequest } from "@/lib/server/gateway";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const response = await workerRequest(request, "/health");
    return NextResponse.json(
      { ok: response.ok },
      { status: response.ok ? 200 : 503 },
    );
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
