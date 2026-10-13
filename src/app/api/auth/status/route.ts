import { NextResponse } from "next/server";
import { workerRequest } from "@/lib/server/gateway";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const response = await workerRequest(request, "/auth/status");
    const data = await response.json();
    return NextResponse.json(
      {
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { configured: false, authenticated: false },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
