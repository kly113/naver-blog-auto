import type { LaunchOptions } from "playwright";
/** Honor the cloud's supported egress proxy; never disable TLS verification. */
export function browserProxy(): LaunchOptions["proxy"] {
  const value = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!value) return undefined;
  const url = new URL(value);
  if (!["http:", "https:", "socks5:"].includes(url.protocol))
    throw new Error("지원되는 네트워크 연결이 필요합니다.");
  return {
    server: url.origin,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}
