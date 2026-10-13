import { chromium, type BrowserContext } from "playwright";
import { browserProxy } from "./proxy.ts";

/** Browser foundation only. Does not log in, fetch categories, or publish. */
export async function createNaverBrowser(
  storageState?: Parameters<import("playwright").Browser["newContext"]>[0],
): Promise<BrowserContext> {
  const browser = await chromium.launch({
    headless: true,
    proxy: browserProxy(),
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  try {
    const context = await browser.newContext({
      ...storageState,
      viewport: { width: 1365, height: 900 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });
    context.on("close", () => {
      void browser.close();
    });
    return context;
  } catch (error) {
    await browser.close();
    throw error;
  }
}
