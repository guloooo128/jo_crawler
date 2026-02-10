import { BrowserManager } from 'agent-browser/dist/browser.js';

/**
 * 增强快照类型（包含 tree 和 refs）
 */
interface EnhancedSnapshot {
  tree: string;
  refs: Record<string, any>;
}

/**
 * Browser 配置选项
 */
export interface BrowserOptions {
  headless?: boolean;
  timeout?: number;
  userAgent?: string;
}

/**
 * Snapshot 配置选项
 */
export interface SnapshotOptions {
  interactive?: boolean;  // 只显示交互元素
  maxDepth?: number;      // 最大深度
  compact?: boolean;      // 紧凑模式
  selector?: string;      // CSS 选择器范围
}

/**
 * BrowserService 封装 Agent-Browser
 * 提供简化的 API 用于网页自动化
 */
export class BrowserService {
  private manager: BrowserManager;
  private currentUrl?: string;
  private savedRefMap?: Record<string, any>;

  constructor() {
    this.manager = new BrowserManager();
  }

  /**
   * 启动浏览器
   */
  async launch(options: BrowserOptions = {}): Promise<void> {
    if (this.manager.isLaunched()) {
      return;
    }

    await this.manager.launch({
      id: 'launch-1',
      action: 'launch',
      headless: options.headless ?? true,
    });

    console.log(`✅ 浏览器已启动 (headless: ${options.headless ?? true})`);
  }

  /**
   * 导航到指定 URL
   */
  async navigate(url: string, options: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle', timeout?: number } = {}): Promise<void> {
    await this.launch();
    this.currentUrl = url;

    try {
      // 使用 Page 对象的 goto 方法
      const page = this.manager.getPage();
      const waitUntil = options.waitUntil || 'domcontentloaded'; // 默认使用 domcontentloaded，更快且更可靠
      const timeout = options.timeout || 60000; // 默认60秒超时

      await page.goto(url, { waitUntil, timeout });
      console.log(`🌐 已导航到: ${url}`);

      // 导航成功后，尝试关闭 Cookie 横幅
      await this.dismissCookieBanner();
    } catch (error) {
      console.error(`❌ 导航失败: ${url}`, error);
      throw error;
    }
  }

  /**
   * 导航到指定 URL（带重试机制，用于解析器生成）
   * 如果网络空闲等待失败，会降级到 domcontentloaded
   */
  async navigateWithRetry(url: string, maxRetries = 2): Promise<void> {
    await this.launch();
    this.currentUrl = url;

    const strategies = [
      { waitUntil: 'domcontentloaded' as const, timeout: 30000, name: 'domcontentloaded' },
      { waitUntil: 'load' as const, timeout: 30000, name: 'load' },
      { waitUntil: 'networkidle' as const, timeout: 15000, name: 'networkidle' },
    ];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      for (const strategy of strategies) {
        try {
          const page = this.manager.getPage();
          await page.goto(url, { waitUntil: strategy.waitUntil, timeout: strategy.timeout });
          console.log(`🌐 已导航到: ${url} (使用 ${strategy.name} 策略)`);

          // 导航成功后，尝试关闭 Cookie 横幅
          await this.dismissCookieBanner();

          return;
        } catch (error: any) {
          const isLastAttempt = attempt === maxRetries && strategy === strategies[strategies.length - 1];

          if (!isLastAttempt) {
            console.log(`⚠️  导航失败 (${strategy.name} 策略)，尝试下一个策略...`);
            await this.waitForTimeout(1000); // 短暂等待后重试
            continue;
          }

          console.error(`❌ 导航失败: ${url}`, error.message);
          throw error;
        }
      }
    }
  }

  /**
   * 尝试关闭 Cookie 同意横幅和其他弹窗
   * 支持多种常见的 Cookie 横幅、调查弹窗等
   */
  async dismissCookieBanner(): Promise<boolean> {
    try {
      const page = this.manager.getPage();
      let closed = false;

      // 1. 首先尝试关闭调查弹窗（优先处理，因为它们会阻止所有操作）
      const surveySelectors = [
        // Bowen & Craggs (SAP 使用)
        '#JSQuestion button[aria-label="Close"]',
        '#JSQuestion .close-button',
        '#JSQuestion button:has-text("Close")',
        '#JSQuestion button:has-text("No thanks")',
        '#JSQuestion button:has-text("Not now")',
        '#JSQuestion button:has-text("×")',
        '#JSOverlay', // 点击遮罩层关闭

        // Qualtrics
        '. qualtrics-survey-css-close',
        'button[class*="close"][class*="survey"]',

        // 通用调查弹窗
        'div[role="alertdialog"] button:has-text("Close")',
        'div[role="dialog"] button:has-text("No thanks")',
        'div[id*="survey"] button:has-text("Close")',
        'div[class*="survey"] button:has-text("×")',
      ];

      for (const selector of surveySelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            await element.click();
            console.log(`✅ 已关闭调查弹窗 (使用选择器: ${selector})`);
            await this.waitForTimeout(500);
            closed = true;
            break;
          }
        } catch {
          continue;
        }
      }

      // 2. 然后尝试关闭 Cookie 横幅
      const cookieBannerSelectors = [
        // TrustArc (Capgemini 等使用)
        '#truste-consent-button',
        '#truste-consent-required',
        'button[aria-label="Accept Cookies"]',
        'button[data-consent="accept"]',

        // OneTrust
        '#onetrust-accept-btn-handler',
        '.ot-sdk-container button[aria-label="Accept Cookies"]',
        '#accept-recommended-btn-handler',

        // CookieBot
        '#CybotCookiebotDialogBodyButtonAccept',
        '.cookie-banner-accept',

        // 通用模式
        'button:has-text("Accept")',
        'button:has-text("Accept All")',
        'button:has-text("Accept Cookies")',
        'button:has-text("I Agree")',
        'button:has-text("Agree")',
        '[class*="cookie"] button:has-text("Accept")',
        '[id*="cookie"] button:has-text("Accept")',
        '[class*="consent"] button:has-text("Accept")',
        '[id*="consent"] button:has-text("Accept")',
      ];

      for (const selector of cookieBannerSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            await element.click();
            console.log(`✅ 已关闭 Cookie 横幅 (使用选择器: ${selector})`);
            await this.waitForTimeout(500);
            closed = true;
            break;
          }
        } catch {
          continue;
        }
      }

      // 3. 如果 CSS 选择器方法都失败，尝试通过 JavaScript 强制关闭
      if (!closed) {
        try {
          const result = await page.evaluate(`
            // 调查弹窗
            const surveyModal = document.querySelector('#JSQuestion');
            if (surveyModal) {
              surveyModal.remove();
              return 'Survey modal (removed)';
            }

            const overlay = document.querySelector('#JSOverlay');
            if (overlay) {
              overlay.remove();
              return 'Survey overlay (removed)';
            }

            // Cookie 横幅 - TrustArc
            const trusteButton = document.querySelector('#truste-consent-button');
            if (trusteButton) {
              trusteButton.click();
              return 'TrustArc';
            }

            // Cookie 横幅 - OneTrust
            const oneTrustButton = document.querySelector('#onetrust-accept-btn-handler');
            if (oneTrustButton) {
              oneTrustButton.click();
              return 'OneTrust';
            }

            // 通用：查找包含 "accept" 文本的按钮
            const buttons = Array.from(document.querySelectorAll('button'));
            const acceptButton = buttons.find(btn => {
              const text = btn.textContent?.toLowerCase() || '';
              return text.includes('accept') || text.includes('agree') || text.includes('i agree');
            });

            if (acceptButton) {
              acceptButton.click();
              return 'Generic accept button';
            }

            return null;
          `);

          if (result) {
            console.log(`✅ 已关闭弹窗 (通过 JavaScript: ${result})`);
            await this.waitForTimeout(500);
            closed = true;
          }
        } catch {
          // JavaScript 方法失败，忽略
        }
      }

      return closed;
    } catch (error) {
      console.log('⚠️  无法关闭弹窗:', (error as Error).message);
      return false;
    }
  }

  /**
   * 获取页面快照（带 refs）
   */
  async getSnapshot(options: SnapshotOptions = {}): Promise<EnhancedSnapshot> {
    const snapshot = await this.manager.getSnapshot({
      interactive: options.interactive ?? true,
      maxDepth: options.maxDepth ?? 5,
      compact: options.compact ?? true,
      selector: options.selector,
    });

    return snapshot;
  }

  /**
   * 获取页面快照（带重试机制）
   * 使用「稳定性检测」：持续获取快照，直到连续两次快照的 refs 数量不再增长，
   * 说明 SPA 已经渲染完成。这比简单的元素数量阈值更可靠。
   * @param options 快照选项
   * @param maxRetries 最大重试次数，默认 8 次
   * @param retryInterval 每次重试间隔（毫秒），默认 2000ms
   */
  async getSnapshotWithRetry(
    options: SnapshotOptions = {},
    maxRetries = 8,
    retryInterval = 2000,
  ): Promise<EnhancedSnapshot> {
    let lastRefCount = 0;
    let stableCount = 0;       // 连续稳定次数
    const stableThreshold = 2; // 连续 N 次不变则认为稳定
    let bestSnapshot: EnhancedSnapshot | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const snapshot = await this.getSnapshot(options);
      const currentRefCount = Object.keys(snapshot.refs).length;
      const treeLength = snapshot.tree?.length || 0;

      // 完全空白（连壳子都没有）→ 继续等待
      if (snapshot.tree === '(no interactive elements)' || currentRefCount === 0) {
        if (attempt < maxRetries) {
          console.log(`⏳ 快照为空，等待 SPA 渲染... (${attempt + 1}/${maxRetries})`);
          await this.waitForTimeout(retryInterval);
          lastRefCount = 0;
          stableCount = 0;
        }
        continue;
      }

      // 保存目前最好的快照
      if (!bestSnapshot || currentRefCount > Object.keys(bestSnapshot.refs).length) {
        bestSnapshot = snapshot;
      }

      // 检查元素数量是否稳定（连续 N 次不增长）
      if (currentRefCount <= lastRefCount) {
        stableCount++;
      } else {
        stableCount = 0;
      }

      console.log(`📊 快照状态: ${currentRefCount} 个 refs, ${treeLength} 字符 (稳定计数: ${stableCount}/${stableThreshold})`);

      if (stableCount >= stableThreshold) {
        if (attempt > 0) {
          console.log(`✅ 页面内容已稳定，共 ${currentRefCount} 个交互元素`);
        }
        return bestSnapshot!;
      }

      lastRefCount = currentRefCount;

      if (attempt < maxRetries) {
        await this.waitForTimeout(retryInterval);
      }
    }

    // 超时但有内容，返回最好的快照
    if (bestSnapshot) {
      const refCount = Object.keys(bestSnapshot.refs).length;
      console.warn(`⚠️  等待超时，使用目前最佳快照 (${refCount} 个 refs)`);
      return bestSnapshot;
    }

    console.warn('⚠️  多次重试后快照仍为空，页面可能未正确加载');
    return await this.getSnapshot(options);
  }

  /**
   * 等待页面内容出现并稳定（适用于 SPA）
   * 使用「稳定性检测」：轮询 DOM 中可交互元素数量，
   * 直到连续 2 次轮询数量不再增长，说明 SPA 动态内容已渲染完成。
   * @param timeout 超时时间（毫秒），默认 20000ms
   * @param minElements 触发稳定性检测的最低元素门槛，默认 5
   */
  async waitForContent(timeout = 20000, minElements = 5): Promise<boolean> {
    const page = this.manager.getPage();
    const startTime = Date.now();
    const pollInterval = 1500;
    let lastCount = 0;
    let stableCount = 0;
    const stableThreshold = 2;  // 连续 N 次不增长视为稳定

    while (Date.now() - startTime < timeout) {
      try {
        const elementCount = await page.evaluate(`
          (() => {
            const interactiveSelectors = [
              'a[href]', 'button', 'input', 'select', 'textarea',
              '[role="button"]', '[role="link"]', '[role="tab"]',
              '[role="menuitem"]', '[onclick]',
            ];
            const elements = new Set();
            for (const sel of interactiveSelectors) {
              document.querySelectorAll(sel).forEach(el => {
                if (el.offsetParent !== null || el.offsetWidth > 0) {
                  elements.add(el);
                }
              });
            }
            return elements.size;
          })()
        `) as number;

        // 只有超过最低门槛才开始检测稳定性
        if (elementCount >= minElements) {
          if (elementCount <= lastCount) {
            stableCount++;
          } else {
            stableCount = 0;
          }

          console.log(`🔍 页面元素: ${elementCount} (稳定计数: ${stableCount}/${stableThreshold})`);

          if (stableCount >= stableThreshold) {
            console.log(`✅ 页面内容已稳定 (${elementCount} 个交互元素)`);
            return true;
          }
        } else {
          console.log(`🔍 页面元素: ${elementCount}，等待更多内容加载...`);
          stableCount = 0;
        }

        lastCount = elementCount;
      } catch {
        // 页面可能在导航中，忽略错误
        stableCount = 0;
      }

      await this.waitForTimeout(pollInterval);
    }

    console.warn(`⚠️  等待页面内容稳定超时 (${timeout}ms)，当前 ${lastCount} 个元素`);
    return false;
  }

  /**
   * 获取 Ref 映射表
   */
  getRefMap() {
    return this.manager.getRefMap();
  }

  /**
   * 保存当前的 Ref 映射表（用于页面跳转后仍能使用旧的 refs）
   */
  saveRefMap() {
    this.savedRefMap = { ...this.manager.getRefMap() };
    console.log(`💾 已保存 ${Object.keys(this.savedRefMap).length} 个 refs`);
  }

  /**
   * 获取保存的 Ref 映射表
   */
  getSavedRefMap() {
    return this.savedRefMap;
  }

  /**
   * 判断选择器是否为 ref
   */
  isRef(selector: string): boolean {
    return this.manager.isRef(selector);
  }

  /**
   * 获取 Locator（支持 ref 和 CSS 选择器）
   * 优先使用保存的 refMap，再使用当前的 refMap
   */
  getLocator(selectorOrRef: string) {
    // 先尝试从保存的 refMap 获取
    if (this.savedRefMap && this.isRef(selectorOrRef)) {
      const ref = selectorOrRef.startsWith('@') ? selectorOrRef.slice(1) : selectorOrRef;
      if (this.savedRefMap[ref]) {
        const page = this.manager.getPage();
        const refData = this.savedRefMap[ref];
        let locator = page.getByRole(refData.role, { name: refData.name, exact: true });
        if (refData.nth !== undefined) {
          locator = locator.nth(refData.nth);
        }
        return locator;
      }
    }
    return this.manager.getLocator(selectorOrRef);
  }

  /**
   * 从 ref 获取 Locator
   */
  getLocatorFromRef(ref: string) {
    return this.manager.getLocatorFromRef(ref);
  }

  /**
   * 点击元素
   */
  async click(selectorOrRef: string): Promise<void> {
    // 在点击前先尝试关闭 Cookie 横幅（防止横幅遮挡）
    await this.dismissCookieBanner();

    const locator = this.getLocator(selectorOrRef);
    await locator.click();
  }

  /**
   * 填写输入框
   */
  async fill(selectorOrRef: string, value: string): Promise<void> {
    const locator = this.getLocator(selectorOrRef);
    await locator.fill(value);
  }

  /**
   * 获取元素文本内容
   */
  async getText(selectorOrRef: string): Promise<string> {
    const locator = this.getLocator(selectorOrRef);
    return (await locator.textContent()) || '';
  }

  /**
   * 获取页面的完整文本内容（用于提取完整 JD）
   */
  async getPageText(): Promise<string> {
    const page = this.manager.getPage();
    return (await page.textContent('body')) || '';
  }

  /**
   * 获取清洁的页面文本内容（去除 script/style/nav/footer/header 等噪音）
   * 这是提取 JD description 的推荐方式
   */
  async getCleanPageText(): Promise<string> {
    const page = this.manager.getPage();
    return await page.evaluate(`
      (() => {
        const clone = document.body.cloneNode(true);
        const selectorsToRemove = [
          'script', 'style', 'noscript', 'iframe',
          'nav', 'footer', 'header',
          '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
          '.cookie-banner', '.cookie-consent', '#cookie-banner',
          '.site-header', '.site-footer', '.site-nav',
          '.nav-menu', '.main-nav', '.footer-nav',
          '.social-links', '.social-media',
          '.breadcrumb', '.breadcrumbs',
        ];
        for (const selector of selectorsToRemove) {
          clone.querySelectorAll(selector).forEach(el => el.remove());
        }
        let text = clone.textContent || '';
        text = text.replace(/[\\t ]+/g, ' ');
        text = text.replace(/\\n\\s*\\n/g, '\\n');
        text = text.replace(/\\n{3,}/g, '\\n\\n');
        return text.trim();
      })()
    `) as string;
  }

  /**
   * 获取页面主要内容区域的文本（更精准地定位 JD 正文）
   * 优先选择 main/article/[role=main] 区域
   */
  async getMainContentText(): Promise<string> {
    const page = this.manager.getPage();
    return await page.evaluate(`
      (() => {
        const mainSelectors = [
          'main', 'article', '[role="main"]',
          '.job-description', '.jd-content', '.job-detail',
          '.job-details', '.posting-content', '.job-content',
          '#job-description', '#job-detail', '#job-content',
          '.content-area', '.main-content', '#main-content',
        ];
        let contentEl = null;
        for (const selector of mainSelectors) {
          contentEl = document.querySelector(selector);
          if (contentEl && contentEl.textContent && contentEl.textContent.trim().length > 200) {
            break;
          }
          contentEl = null;
        }
        if (!contentEl) {
          contentEl = document.body;
        }
        const clone = contentEl.cloneNode(true);
        const remove = ['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header',
          '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]'];
        for (const sel of remove) {
          clone.querySelectorAll(sel).forEach(el => el.remove());
        }
        let text = clone.textContent || '';
        text = text.replace(/[\\t ]+/g, ' ');
        text = text.replace(/\\n\\s*\\n/g, '\\n');
        text = text.replace(/\\n{3,}/g, '\\n\\n');
        return text.trim();
      })()
    `) as string;
  }

  /**
   * 使用选择器获取元素的 innerHTML
   */
  async getInnerHTML(selector: string): Promise<string> {
    const page = this.manager.getPage();
    const html = await page.locator(selector).innerHTML();
    return html || '';
  }

  /**
   * 获取元素内部 HTML
   */
  async getHTML(selectorOrRef: string): Promise<string> {
    const locator = this.getLocator(selectorOrRef);
    return (await locator.innerHTML()) || '';
  }

  /**
   * 获取元素属性
   */
  async getAttribute(selectorOrRef: string, attributeName: string): Promise<string | null> {
    const locator = this.getLocator(selectorOrRef);
    return await locator.getAttribute(attributeName);
  }

  /**
   * 获取当前页面 URL
   */
  async getCurrentUrl(): Promise<string> {
    const page = this.manager.getPage();
    return page.url();
  }

  /**
   * 获取页面标题
   */
  async getTitle(): Promise<string> {
    const page = this.manager.getPage();
    return await page.title();
  }

  /**
   * 等待指定时间（毫秒）
   */
  async waitForTimeout(milliseconds: number): Promise<void> {
    const page = this.manager.getPage();
    await page.waitForTimeout(milliseconds);
  }

  /**
   * 等待选择器出现
   */
  async waitForSelector(selectorOrRef: string, timeout = 5000): Promise<void> {
    const locator = this.getLocator(selectorOrRef);
    await locator.waitFor({ timeout });
  }

  /**
   * 滚动页面以触发懒加载内容
   * @param scrollCount 滚动次数，默认 3 次
   * @param scrollDelay 每次滚动后的延迟（毫秒），默认 1000ms
   */
  async scrollPage(scrollCount = 3, scrollDelay = 1000): Promise<void> {
    const page = this.manager.getPage();

    for (let i = 0; i < scrollCount; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
      });
      await this.waitForTimeout(scrollDelay);
    }

    // 滚动回顶部
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await this.waitForTimeout(500);
  }

  /**
   * 获取页面中所有职位链接（通过解析完整 HTML，支持 JavaScript 渲染的内容）
   * 专门用于处理嵌入式 Job Board（如 Greenhouse、Lever 等）
   * 也支持从 iframe 中提取职位链接
   */
  async getJobLinksFromHTML(): Promise<Array<{ url: string; name: string; location?: string }>> {
    const page = this.manager.getPage();
    let allLinks: Array<{ url: string; name: string; location?: string }> = [];

    // 首先检查主页面
    // @ts-ignore - browser environment code
    const mainPageLinks = await page.evaluate(() => {
      const links = [];
      const allLinks = document.querySelectorAll('a');

      for (const link of allLinks) {
        const href = link.getAttribute('href');
        if (!href) continue;

        const text = link.textContent ? link.textContent.trim() : '';
        const linkLower = href.toLowerCase();

        // 检查是否是职位链接
        const isJobLink =
          linkLower.includes('/jobs/') ||
          linkLower.includes('greenhouse.io') ||
          linkLower.includes('lever.co') ||
          linkLower.includes('myworkdayjobs.com') ||
          linkLower.includes('workday.com');

        if (!isJobLink) continue;

        // 排除导航和过滤链接
        const excludeKeywords = ['login', 'signup', 'signin', 'search', 'filter', 'page=', 'prev', 'next'];
        if (excludeKeywords.some(function(kw) { return linkLower.indexOf(kw) !== -1; })) continue;

        // 提取职位名称和地点
        let jobTitle = text;
        let location = '';

        // 尝试从链接内部的结构提取信息
        const titleEl = link.querySelector('[class*="title"], [class*="position"], [class*="role"]');
        const locationEl = link.querySelector('[class*="location"], [class*="metadata"]');

        if (titleEl) jobTitle = titleEl.textContent ? titleEl.textContent.trim() : text;
        if (locationEl) location = locationEl.textContent ? locationEl.textContent.trim() : '';

        // 清理标题
        jobTitle = jobTitle.replace(/\s+/g, ' ').trim();
        if (jobTitle.length < 5 || jobTitle.length > 200) continue;

        // 构建完整 URL
        let fullUrl = href;
        if (href.startsWith('/')) {
          fullUrl = window.location.origin + href;
        } else if (!href.startsWith('http')) {
          fullUrl = window.location.origin + '/' + href;
        }

        links.push({
          url: fullUrl,
          name: jobTitle,
          location: location || undefined,
        });
      }

      // 去重
      const seen = new Set();
      return links.filter(function(link) {
        if (seen.has(link.url)) return false;
        seen.add(link.url);
        return true;
      });
    });

    allLinks = allLinks.concat(mainPageLinks);

    // 检查是否有 iframe（特别是 Greenhouse 嵌入式 job board）
    try {
      const frames = page.frames();
      for (const frame of frames) {
        const frameUrl = frame.url();
        // 跳过主页面和非职位相关的 iframe
        if (frameUrl === 'about:blank' || !frameUrl.includes('greenhouse') && !frameUrl.includes('job')) {
          continue;
        }

        console.log(`🔍 检测到职位相关 iframe: ${frameUrl.substring(0, 100)}...`);

        // 从 iframe 中提取职位链接
        // @ts-ignore - browser environment code
        const iframeLinks = await frame.evaluate(() => {
          const links = [];
          const allLinks = document.querySelectorAll('a');

          for (const link of allLinks) {
            const href = link.getAttribute('href');
            if (!href) continue;

            const text = link.textContent ? link.textContent.trim() : '';
            const linkLower = href.toLowerCase();

            // 排除非职位链接（登录、注册等）
            if (linkLower.includes('sign_in') ||
                linkLower.includes('login') ||
                linkLower.includes('signup') ||
                linkLower.includes('create') && text.toLowerCase().includes('alert')) {
              continue;
            }

            // 清理标题
            const jobTitle = text.replace(/\s+/g, ' ').trim();
            if (jobTitle.length < 5 || jobTitle.length > 200) continue;

            // 提取地点信息
            let location = '';
            const locationEl = link.querySelector('[class*="location"], [class*="metadata"]');
            if (locationEl) location = locationEl.textContent ? locationEl.textContent.trim() : '';

            // 构建完整 URL
            let fullUrl = href;
            if (href.startsWith('/')) {
              fullUrl = window.location.origin + href;
            } else if (!href.startsWith('http')) {
              fullUrl = window.location.origin + '/' + href;
            }

            links.push({
              url: fullUrl,
              name: jobTitle,
              location: location || undefined,
            });
          }

          // 去重
          const seen = new Set();
          return links.filter(function(link) {
            if (seen.has(link.url)) return false;
            seen.add(link.url);
            return true;
          });
        });

        console.log(`✅ 从 iframe 中找到 ${iframeLinks.length} 个职位链接`);
        allLinks = allLinks.concat(iframeLinks);
      }
    } catch (e: any) {
      console.log(`⚠️  检查 iframe 时出错: ${e.message}`);
    }

    // 全局去重
    const seen = new Set<string>();
    return allLinks.filter(link => {
      if (seen.has(link.url)) return false;
      seen.add(link.url);
      return true;
    });
  }

  /**
   * 截图
   */
  async screenshot(path: string, fullPage = false): Promise<void> {
    const page = this.manager.getPage();
    await page.screenshot({
      path,
      fullPage,
    });
    console.log(`📸 截图已保存: ${path}`);
  }

  /**
   * 截图并返回路径（自动生成文件名）
   */
  async takeScreenshot(fullPage = false): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `screenshot-${timestamp}.png`;
    const path = `output/screenshots/${filename}`;

    // 确保目录存在
    const fs = await import('fs-extra');
    await fs.ensureDir(`output/screenshots`);

    await this.screenshot(path, fullPage);
    return path;
  }

  /**
   * 后退
   */
  async goBack(): Promise<void> {
    const page = this.manager.getPage();
    await page.goBack();
  }

  /**
   * 前进
   */
  async goForward(): Promise<void> {
    const page = this.manager.getPage();
    await page.goForward();
  }

  /**
   * 刷新页面
   */
  async reload(): Promise<void> {
    const page = this.manager.getPage();
    await page.reload();
  }

  /**
   * 执行 JavaScript 代码
   */
  async evaluate<T>(pageFunction: () => T): Promise<T> {
    const page = this.manager.getPage();
    return await page.evaluate(pageFunction);
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    if (this.manager.isLaunched()) {
      await this.manager.close();
      console.log('✅ 浏览器已关闭');
    }
  }

  /**
   * 检查浏览器是否已启动
   */
  isLaunched(): boolean {
    return this.manager.isLaunched();
  }
}
