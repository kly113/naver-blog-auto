import { NextResponse } from "next/server";
import { getProfile, saveProfile } from "@/lib/db";
import { profileSchema } from "@/lib/validation";
import { mutationGuard, errorResponse } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json({
      profile: getProfile(),
      connection: "not_connected",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  const blocked = mutationGuard(request);
  if (blocked) return blocked;
  try {
    const result = profileSchema.safeParse(await request.json());
    if (!result.success)
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      );
    saveProfile(result.data);
    return NextResponse.json({
      profile: result.data,
      connection: "not_connected",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
