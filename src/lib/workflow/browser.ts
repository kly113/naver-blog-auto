import type { BrowserContext, Page } from "playwright";
import { createNaverBrowser } from "../automation/naver.ts";
import {
  loadBrowserSession,
  saveBrowserSession,
  removeBrowserSession,
} from "./session-vault.ts";
import { blogs, getSetting, historyCoverage, setSetting } from "./store.ts";
import type { Blog, Connection } from "./types.ts";
import type { RemoteAction } from "./validation.ts";

export function approvedNaverAddress(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["naver.com", "naver.net", "pstatic.net"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}
export class NaverBrowser {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private connected = false;
  private editing = false;
  private frozen = false;

  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(work, work);
    this.tail = pending.catch(() => {});
    return pending;
  }
  async ensure() {
    if (!this.context) {
      const saved = await loadBrowserSession();
      this.context = await createNaverBrowser(
        saved
          ? {
              storageState: saved as Awaited<
                ReturnType<BrowserContext["storageState"]>
              >,
            }
          : undefined,
      );
      await this.context.route("**/*", async (route) =>
        approvedNaverAddress(route.request().url())
          ? route.continue()
          : route.abort(),
      );
      this.page = await this.context.newPage();
      this.context.on("page", (page) => {
        void page.opener().then((opener) => {
          if (!opener) return;
          this.page = page;
          page.on("close", () => {
            if (this.page === page && !opener.isClosed()) this.page = opener;
          });
        });
      });
    }
    return { context: this.context, page: this.page! };
  }
  status(): Connection {
    return {
      connected: this.connected,
      browserOpen: Boolean(this.page),
      officialUrl:
        this.page && approvedNaverAddress(this.page.url())
          ? new URL(this.page.url()).origin + new URL(this.page.url()).pathname
          : null,
      blogs: blogs(),
      selectedBlog: getSetting<string | null>("selectedBlog", null),
      selectedCategory: getSetting<string | null>("selectedCategory", null),
      history: historyCoverage(),
    };
  }
  async login() {
    if (this.editing)
      throw new Error("편집 중인 글을 먼저 완료하거나 브라우저를 닫아 주세요.");
    return this.exclusive(async () => {
      const { page } = await this.ensure();
      this.connected = false;
      await page.goto(
        "https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fblog.naver.com%2FMyBlog.naver",
        { waitUntil: "domcontentloaded", timeout: 30_000 },
      );
    });
  }
  async screenshot() {
    return this.exclusive(async () => {
      if (!this.page || !approvedNaverAddress(this.page.url()))
        throw new Error("공식 로그인 화면을 먼저 여세요.");
      return this.page.screenshot({
        type: "jpeg",
        quality: 70,
        animations: "disabled",
      });
    });
  }
  async action(action: RemoteAction) {
    if (this.frozen)
      throw new Error(
        "자동 작성 결과 확인 중에는 화면 조작이 잠시 제한됩니다.",
      );
    return this.exclusive(async () => {
      if (!this.page || !approvedNaverAddress(this.page.url()))
        throw new Error("공식 네이버 화면이 열려 있지 않습니다.");
      if (action.action === "click")
        await this.page.mouse.click(action.x, action.y);
      if (action.action === "key") await this.page.keyboard.press(action.key);
      if (action.action === "text")
        await this.page.keyboard.insertText(action.text);
      if (action.action === "scroll")
        await this.page.mouse.wheel(0, action.delta);
    });
  }
  async confirmLogin() {
    if (this.editing)
      throw new Error("편집 중에는 로그인 확인을 다시 실행할 수 없습니다.");
    return this.exclusive(async () => {
      this.connected = false;
      const { context, page } = await this.ensure();
      const cookies = await context.cookies("https://naver.com");
      if (
        !cookies.some((cookie) => cookie.name === "NID_AUT") ||
        !cookies.some((cookie) => cookie.name === "NID_SES")
      )
        throw new Error(
          "네이버 공식 화면에서 로그인과 보안 확인을 완료해 주세요.",
        );
      await page.goto("https://blog.naver.com/MyBlog.naver", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      if (new URL(page.url()).hostname === "nid.naver.com")
        throw new Error("네이버 로그인 상태를 확인할 수 없습니다.");
      const result = await discoverBlog(page);
      if (!result)
        throw new Error(
          "본인 블로그와 카테고리를 확인하지 못했습니다. 화면의 보안 절차를 완료한 뒤 다시 확인하세요.",
        );
      setSetting("blogs", [result]);
      setSetting("selectedBlog", result.id);
      const selected = getSetting<string | null>("selectedCategory", null);
      if (!result.categories.some((category) => category.id === selected))
        setSetting("selectedCategory", result.categories[0].id);
      const state = await context.storageState();
      // Persist official session cookies only; never capture localStorage/form/autofill data.
      await saveBrowserSession({
        cookies: state.cookies.filter(
          (cookie) =>
            cookie.domain.replace(/^\./, "") === "naver.com" ||
            cookie.domain.endsWith(".naver.com"),
        ),
        origins: [],
      });
      this.connected = true;
      return this.status();
    });
  }
  async withConnected<T>(
    work: (page: Page, context: BrowserContext) => Promise<T>,
  ): Promise<T> {
    return this.exclusive(async () => {
      const { context, page } = await this.ensure();
      const cookies = await context.cookies("https://naver.com");
      if (
        !cookies.some((cookie) => cookie.name === "NID_AUT") ||
        !cookies.some((cookie) => cookie.name === "NID_SES")
      ) {
        this.connected = false;
        throw new Error("네이버에 다시 로그인해 주세요.");
      }
      return work(page, context);
    });
  }
  reserveEditor(value: boolean) {
    this.editing = value;
  }
  freeze(value: boolean) {
    this.frozen = value;
  }
  async close() {
    await this.exclusive(async () => {
      await this.context?.close();
      this.context = null;
      this.page = null;
      this.connected = false;
      this.editing = false;
      await removeBrowserSession();
      setSetting("blogs", []);
      setSetting("selectedBlog", null);
      setSetting("selectedCategory", null);
      setSetting("history", {
        complete: false,
        scanned: 0,
        total: null,
        message: "계정 연결이 해제되었습니다.",
        syncedAt: null,
      });
    });
  }
  async shutdown() {
    await this.context?.close();
    this.context = null;
    this.page = null;
  }
}
export async function discoverBlog(page: Page): Promise<Blog | null> {
  const main = page.frame({ name: "mainFrame" });
  const document = main || page;
  const frameUrl =
    main?.url() ||
    (await page
      .locator("iframe#mainFrame")
      .getAttribute("src")
      .catch(() => null)) ||
    page.url();
  const url = new URL(frameUrl, page.url());
  let blogId = url.searchParams.get("blogId");
  if (!blogId) {
    const match = new URL(page.url()).pathname.match(
      /^\/([a-zA-Z0-9_-]{2,50})\/?$/,
    );
    if (match && !match[1].endsWith("naver")) blogId = match[1];
  }
  if (!blogId || !/^[a-zA-Z0-9_-]{2,50}$/.test(blogId)) return null;
  const links = await document
    .locator("a[href*='categoryNo=']")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        href: (element as HTMLAnchorElement).href,
        text: element.textContent?.trim() || "",
      })),
    );
  const categories: Blog["categories"] = [];
  for (const link of links) {
    const categoryUrl = new URL(link.href, page.url());
    const id = categoryUrl.searchParams.get("categoryNo");
    if (
      categoryUrl.searchParams.get("blogId") &&
      categoryUrl.searchParams.get("blogId") !== blogId
    )
      continue;
    const name = link.text.replace(/\s*\([\d,]+\)\s*$/, " ").trim();
    if (
      id &&
      /^\d+$/.test(id) &&
      id !== "0" &&
      name &&
      name.length <= 100 &&
      !categories.some((category) => category.id === id)
    )
      categories.push({ id, name });
  }
  if (!categories.length) return null;
  return {
    id: blogId,
    name:
      (await page.title()).replace(/\s*:\s*네이버 블로그.*$/, " ").trim() ||
      blogId,
    categories,
  };
}
