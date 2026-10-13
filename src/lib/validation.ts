import { z } from "zod";

export const profileSchema = z
  .object({
    blogId: z
      .string()
      .trim()
      .min(2)
      .max(50)
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        "블로그 ID에는 영문, 숫자, _, -만 사용할 수 있습니다.",
      ),
    displayName: z.string().trim().min(1).max(50),
    categories: z
      .array(z.string().trim().min(1).max(50))
      .min(1)
      .max(30)
      .transform((values) => [...new Set(values)]),
    selectedCategory: z.string().trim().min(1).max(50),
  })
  .refine((data) => data.categories.includes(data.selectedCategory), {
    message: "등록된 카테고리를 선택하세요.",
    path: ["selectedCategory"],
  });

export function normalizeInstagramUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["instagram.com", "www.instagram.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("HTTPS 인스타그램 게시물 URL을 입력하세요.");
  }
  const match = url.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]{1,100})\/?$/);
  if (!match) throw new Error("인스타그램 게시물 또는 릴스 URL을 입력하세요.");
  return `https://www.instagram.com/${match[1]}/${match[2]}/`;
}

export const postSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2048)
    .transform((value, context) => {
      try {
        return normalizeInstagramUrl(value);
      } catch {
        context.addIssue({
          code: "custom",
          message: "유효한 인스타그램 게시물 또는 릴스 URL이 필요합니다.",
        });
        return z.NEVER;
      }
    }),
});
