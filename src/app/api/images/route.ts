import { NextResponse } from "next/server";
import { listImages, registerImage } from "@/lib/db";
import { fingerprintImage, MAX_IMAGE_BYTES } from "@/lib/images";
import { mutationGuard, errorResponse } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json({ images: listImages() }); } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  const blocked = mutationGuard(request); if (blocked) return blocked;
  if (Number(request.headers.get("content-length") || 0) > MAX_IMAGE_BYTES + 65536)
    return NextResponse.json({ error: "이미지는 10MB 이하로 업로드하세요." }, { status: 413 });
  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File)) return NextResponse.json({ error: "이미지를 선택하세요." }, { status: 400 });
    if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "이미지는 10MB 이하로 업로드하세요." }, { status: 413 });
    let fingerprint;
    try { fingerprint = await fingerprintImage(Buffer.from(await file.arrayBuffer())); }
    catch { return NextResponse.json({ error: "10MB 이하의 정적 JPEG, PNG, WebP 이미지를 선택하세요. 최대 2,500만 화소를 지원합니다." }, { status: 400 }); }
    if (!registerImage({ ...fingerprint, original_name: file.name.slice(0, 200) }))
      return NextResponse.json({ error: "이미 등록한 이미지입니다. 파일 내용 또는 동일한 픽셀이 확인되었습니다." }, { status: 409 });
    return NextResponse.json({ images: listImages() }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
