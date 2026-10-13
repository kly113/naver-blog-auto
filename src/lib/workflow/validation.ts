import { z } from "zod";
import { normalizeInstagramUrl } from "../validation.ts";

export const jobInputSchema = z.object({
  sourceUrl: z
    .string()
    .trim()
    .max(2048)
    .default("")
    .transform((value, ctx) => {
      if (!value) return "";
      try {
        return normalizeInstagramUrl(value);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "유효한 인스타그램 게시물 또는 릴스 URL을 입력하세요.",
        });
        return z.NEVER;
      }
    }),
  caption: z.string().trim().max(8000).default(""),
  location: z.string().trim().max(100).default(""),
  salon: z.string().trim().max(100).default(""),
  confirmedTreatments: z.string().trim().max(2000).default(""),
  mode: z.enum(["draft", "publish"]).default("draft"),
  rightsConfirmed: z.literal(true, {
    error: "사진을 소유하거나 사용 허락을 받았는지 확인해 주세요.",
  }),
});
export const draftSchema = z.object({
  title: z.string().trim().min(1).max(100),
  blocks: z
    .array(
      z.object({
        text: z.string().trim().max(4000),
        imageIndex: z.number().int().min(0).max(19).nullable(),
      }),
    )
    .min(1)
    .max(30),
  hashtags: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[가-힣A-Za-z0-9_]{1,40}$/),
    )
    .max(20),
  origin: z.enum(["openai", "manual"]).default("manual"),
});
export const selectionSchema = z.object({
  blogId: z.string().min(1).max(50),
  categoryId: z.string().min(1).max(50),
});
export const remoteActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("click"),
    x: z.number().min(0).max(1365),
    y: z.number().min(0).max(900),
  }),
  z.object({
    action: z.literal("key"),
    key: z.enum([
      "Enter",
      "Tab",
      "Backspace",
      "Delete",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Escape",
      "Home",
      "End",
      "Control+a",
    ]),
  }),
  z.object({ action: z.literal("text"), text: z.string().min(1).max(20000) }),
  z.object({
    action: z.literal("scroll"),
    delta: z.number().min(-900).max(900),
  }),
]);
export type RemoteAction = z.infer<typeof remoteActionSchema>;
