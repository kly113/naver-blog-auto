import { NextResponse } from "next/server";
import { createPost, getProfile, listPosts } from "@/lib/db";
import { postSchema } from "@/lib/validation";
import { mutationGuard, errorResponse } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json({ posts: listPosts() });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  const blocked = mutationGuard(request);
  if (blocked) return blocked;
  try {
    const result = postSchema.safeParse(await request.json());
    if (!result.success)
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 },
      );
    const profile = getProfile();
    if (!profile)
      return NextResponse.json(
        { error: "먼저 블로그와 카테고리를 등록하세요." },
        { status: 409 },
      );
    const post = createPost(result.data.url, profile.selectedCategory);
    if (!post)
      return NextResponse.json(
        { error: "이미 등록한 인스타그램 게시물입니다." },
        { status: 409 },
      );
    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
