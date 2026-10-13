import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "블로그 스튜디오 · Naver Blog Auto",
  description: "사진에서 시작하는 블로그 콘텐츠 관리",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
