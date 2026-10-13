import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MEDIA_HOSTS = ["cdninstagram.com", "fbcdn.net", "pstatic.net"];
export function isApprovedMediaUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      MEDIA_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224 ||
      (a === 198 && [18, 19].includes(b))
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      const tail = normalized.slice(7);
      if (tail.includes(".")) return isPublicAddress(tail);
      const parts = tail.split(":");
      if (parts.length !== 2) return false;
      const high = parseInt(parts[0], 16),
        low = parseInt(parts[1], 16);
      return isPublicAddress(
        `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
      );
    }
    return (
      /^[23][0-9a-f]{0,3}:/.test(normalized) &&
      !normalized.startsWith("2001:db8:")
    );
  }
  return false;
}
export async function downloadMedia(value: string): Promise<Buffer> {
  let current = value;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!isApprovedMediaUrl(current))
      throw new Error("허용된 사진 제공 주소가 아닙니다.");
    const url = new URL(current);
    const addresses = await lookup(url.hostname, { all: true });
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicAddress(address))
    )
      throw new Error("안전하지 않은 사진 주소입니다.");
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("사진 주소를 확인할 수 없습니다.");
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok || !response.body)
      throw new Error(
        "원본 사진을 내려받을 수 없습니다. 직접 업로드해 주세요.",
      );
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        size += chunk.length;
        if (size > 10 * 1024 * 1024)
          throw new Error("사진이 10MB를 초과합니다.");
        chunks.push(chunk);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks);
  }
  throw new Error("사진 주소의 이동이 너무 많습니다.");
}
