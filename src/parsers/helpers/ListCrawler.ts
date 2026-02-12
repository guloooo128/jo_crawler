/**
 * ListCrawler — 列表页爬取模板
 *
 * 提供标准的列表页爬取流程（模板方法模式）：
 *   Phase 1: 翻页 + LLM 识别职位链接 + 收集 URL
 *   Phase 2: 逐个导航详情页 + 提取数据
 *
 * 生成的解析器只需提供站点特定配置（翻页策略、描述标记、公司名等），
 * 无需重复实现翻页循环和详情提取逻辑。
 */

import type { BrowserService } from '../../services/BrowserService.js';
import type { JobData, ParseOptions } from '../../models/JobData.js';
import { TextCleaner, type CleanDescriptionOptions } from './TextCleaner.js';
import { FieldParser } from './FieldParser.js';

/**
 * 翻页策略
 */
export interface PaginationConfig {
  /** 翻页策略类型 */
  strategy: 'next-button' | 'load-more' | 'url-param' | 'scroll-load' | 'auto';

  /** 自定义按钮匹配关键词（如 ["Next", "下一页", "Go to Next Page"]） */
  keywords?: string[];

  /** 自定义按钮匹配函数（优先于 keywords） */
  matcher?: (ref: string, info: any) => boolean;

  /** 翻页后等待时间（ms），默认 3000 */
  waitAfter?: number;
}

/**
 * ListCrawler 配置
 */
export interface ListCrawlerConfig {
  /** 公司名称 */
  companyName: string;

  /** 翻页配置 */
  pagination?: PaginationConfig;

  /** 描述清洗配置 */
  descriptionOptions?: CleanDescriptionOptions;

  /** Cookie/弹窗处理（在开始采集前执行） */
  dismissPopup?: (browser: BrowserService, refs: Record<string, any>) => Promise<void>;

  /** 自定义字段提取器（覆盖默认行为） */
  customExtractors?: {
    location?: (rawText: string, tree: string) => string;
    postDate?: (rawText: string) => string;
    salary?: (rawText: string) => string;
    jobType?: (rawText: string) => string;
  };

  /** 详情页等待时间（ms），默认 2000 */
  detailWait?: number;

  /** 是否从详情页快照提取标题（覆盖列表页获取的标题） */
  overrideTitleFromDetail?: boolean;
}

/** 默认翻页按钮关键词 */
const DEFAULT_NEXT_KEYWORDS = [
  'next', 'Next', 'Next Page', '下一页', 'Go to Next Page',
  'Show More', 'Load More', 'View More', 'next page',
];

/** 默认 Load More 按钮关键词 */
const DEFAULT_LOAD_MORE_KEYWORDS = [
  'Load More', 'Show More', 'View More', '加载更多', 'load more',
];

/**
 * 职位链接信息
 */
export interface JobLink {
  ref: string;
  name: string;
  url: string;
}

export class ListCrawler {
  /**
   * 标准列表页爬取流程
   *
   * @param browser 浏览器实例
   * @param options 解析选项（maxItems, maxPages 等）
   * @param config 站点特定配置
   * @param createJobData 创建 JobData 的工厂函数（来自 BaseParser）
   * @returns 提取的职位数据列表
   */
  static async crawl(
    browser: BrowserService,
    options: ParseOptions,
    config: ListCrawlerConfig,
    createJobData: (fields: Partial<JobData>) => JobData,
  ): Promise<JobData[]> {
    const jobs: JobData[] = [];
    const maxItems = options.maxItems ?? 50;
    const maxPages = options.maxPages ?? 5;

    // Phase 0: 处理弹窗
    if (config.dismissPopup) {
      try {
        const { refs } = await browser.getSnapshot({ interactive: true, maxDepth: 3 });
        await config.dismissPopup(browser, refs);
      } catch {
        // 弹窗处理失败不影响主流程
      }
    }

    // ═══════ Phase 1: 翻页 + 收集职位 URL ═══════
    const allLinks = await ListCrawler.collectAllLinks(
      browser, maxItems, maxPages, config
    );

    if (allLinks.length === 0) {
      console.log('⚠️  未收集到任何职位链接');
      return jobs;
    }

    const linksToProcess = allLinks.slice(0, maxItems);
    console.log(`✅ 共收集 ${linksToProcess.length} 个职位链接，开始提取详情`);

    // ═══════ Phase 2: 逐个导航详情页提取数据 ═══════
    for (const link of linksToProcess) {
      try {
        console.log(`🚀 提取: ${link.name}`);

        await browser.navigate(link.url);
        await ListCrawler.delay(config.detailWait ?? 2000);

        // 获取详情页内容
        let rawText = '';
        try {
          rawText = await browser.getMainContentText();
        } catch {
          try {
            rawText = await browser.getCleanPageText();
          } catch {
            rawText = '';
          }
        }

        // 获取 accessibility tree
        let tree = '';
        try {
          const snapshot = await browser.getSnapshot({ interactive: true, maxDepth: 5 });
          tree = snapshot.tree;
        } catch {
          // ignore
        }

        // 提取 description
        const description = TextCleaner.cleanDescription(rawText, config.descriptionOptions);

        // 提取 location
        const location = config.customExtractors?.location
          ? config.customExtractors.location(rawText, tree)
          : FieldParser.extractLocationAll(tree, description, link.name);

        // 提取元数据（postDate, deadLine, jobType, salary）
        const metadata = FieldParser.extractJobMetadata(tree, description);

        // 允许自定义提取器覆盖
        const postDate = config.customExtractors?.postDate?.(rawText) ?? metadata.postDate;
        const salary = config.customExtractors?.salary?.(rawText) ?? metadata.salary;
        const jobType = config.customExtractors?.jobType?.(rawText) ?? metadata.jobType;

        // 提取标题（默认使用列表页标题，可配置从详情页覆盖）
        let jobTitle = link.name;
        if (config.overrideTitleFromDetail) {
          try {
            const pageTitle = await browser.getTitle();
            const extracted = FieldParser.extractTitleFromPageTitle(pageTitle);
            if (extracted) jobTitle = extracted;
          } catch { /* ignore */ }
        }

        jobs.push(createJobData({
          job_title: jobTitle,
          company_name: config.companyName,
          location,
          job_link: link.url,
          post_date: postDate,
          dead_line: metadata.deadLine,
          job_type: jobType,
          description,
          salary,
          source: config.companyName,
        }));
      } catch (err: any) {
        console.error(`❌ 提取失败 (${link.url}): ${err.message}`);
      }
    }

    return jobs;
  }

  /**
   * Phase 1 实现：翻页 + 收集所有职位链接
   */
  private static async collectAllLinks(
    browser: BrowserService,
    maxItems: number,
    maxPages: number,
    config: ListCrawlerConfig,
  ): Promise<JobLink[]> {
    const allLinks = new Map<string, JobLink>();
    let currentPage = 1;

    while (currentPage <= maxPages && allLinks.size < maxItems) {
      console.log(`📄 第 ${currentPage} 页...`);

      const { tree, refs } = await browser.getSnapshotWithRetry(
        { interactive: true, maxDepth: 5 }, 3, 2000
      );

      // 使用 LLM 智能识别职位链接
      const jobLinks = await browser.llmIdentifyJobLinks(tree, refs);
      console.log(`🤖 LLM 识别到 ${jobLinks.length} 个职位链接`);

      if (jobLinks.length === 0 && currentPage === 1) {
        // 首页就没有识别到，尝试 HTML 解析 fallback
        console.log('⚠️  LLM 未识别到职位链接，尝试 HTML 解析...');
        try {
          const htmlLinks = await browser.getJobLinksFromHTML();
          for (const link of htmlLinks) {
            if (!allLinks.has(link.url)) {
              allLinks.set(link.url, { ref: '', name: link.name, url: link.url });
            }
          }
        } catch { /* ignore */ }
        break;
      }

      if (jobLinks.length === 0) {
        console.log('⚠️  LLM 未识别到职位链接，停止翻页');
        break;
      }

      // 转换格式 并收集链接 URL
      const jobRefs = jobLinks.map(jl => [
        jl.ref.replace('@', ''),
        { role: 'link', name: jl.name },
      ] as [string, any]);

      const pageLinks = await ListCrawler.collectJobLinks(browser, jobRefs);
      console.log(`🔗 收集到 ${pageLinks.length} 个职位链接`);

      // 去重合并
      let newCount = 0;
      for (const link of pageLinks) {
        if (!allLinks.has(link.url)) {
          allLinks.set(link.url, link);
          newCount++;
        }
      }

      if (newCount === 0) {
        console.log('⚠️  没有新链接，停止翻页');
        break;
      }

      if (allLinks.size >= maxItems) break;

      // 翻页
      const didPaginate = await ListCrawler.paginate(browser, refs, config.pagination);
      if (!didPaginate) break;
      currentPage++;
    }

    return Array.from(allLinks.values());
  }

  /**
   * 收集职位链接的 URL
   */
  static async collectJobLinks(
    browser: BrowserService,
    jobRefEntries: Array<[string, any]>,
  ): Promise<JobLink[]> {
    const links: JobLink[] = [];
    const baseUrl = await browser.getCurrentUrl();

    for (const [refId, refInfo] of jobRefEntries) {
      try {
        const href = await browser.getAttribute(`@${refId}`, 'href');
        if (href) {
          let fullUrl: string;
          try {
            fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).href;
          } catch {
            fullUrl = href;
          }
          links.push({
            ref: refId,
            name: refInfo.name || '',
            url: fullUrl,
          });
        }
      } catch {
        // 跳过无法获取 href 的 ref
      }
    }

    return links;
  }

  /**
   * 执行翻页操作
   *
   * @returns 是否成功翻页
   */
  private static async paginate(
    browser: BrowserService,
    refs: Record<string, any>,
    config?: PaginationConfig,
  ): Promise<boolean> {
    const strategy = config?.strategy ?? 'auto';
    const waitAfter = config?.waitAfter ?? 3000;

    // 自定义 matcher 优先
    if (config?.matcher) {
      const btn = Object.entries(refs).find(([k, r]) => config.matcher!(k, r));
      if (btn) {
        console.log(`➡️  翻页: ${btn[1].name || btn[0]}`);
        await browser.click(`@${btn[0]}`);
        await ListCrawler.delay(waitAfter);
        return true;
      }
    }

    // 根据策略选择翻页方式
    switch (strategy) {
      case 'next-button':
        return ListCrawler.paginateByButton(browser, refs, config?.keywords ?? DEFAULT_NEXT_KEYWORDS, waitAfter);

      case 'load-more':
        return ListCrawler.paginateByButton(browser, refs, config?.keywords ?? DEFAULT_LOAD_MORE_KEYWORDS, waitAfter);

      case 'scroll-load':
        return ListCrawler.paginateByScroll(browser, waitAfter);

      case 'auto':
      default:
        // 自动检测：先试 next button，再试 load more，最后试 scroll
        if (await ListCrawler.paginateByButton(browser, refs, DEFAULT_NEXT_KEYWORDS, waitAfter)) {
          return true;
        }
        if (await ListCrawler.paginateByButton(browser, refs, DEFAULT_LOAD_MORE_KEYWORDS, waitAfter)) {
          return true;
        }
        console.log('⚠️  未找到翻页按钮，停止翻页');
        return false;
    }
  }

  /**
   * 通过点击按钮翻页
   */
  private static async paginateByButton(
    browser: BrowserService,
    refs: Record<string, any>,
    keywords: string[],
    waitAfter: number,
  ): Promise<boolean> {
    // 查找匹配关键词的按钮或链接
    const btn = Object.entries(refs).find(([_k, r]) => {
      if (r.role !== 'button' && r.role !== 'link') return false;
      const name = (r.name || '').toLowerCase();
      return keywords.some(kw => name.includes(kw.toLowerCase()));
    });

    if (btn) {
      console.log(`➡️  点击翻页: ${btn[1].name}`);
      await browser.click(`@${btn[0]}`);
      await ListCrawler.delay(waitAfter);
      return true;
    }

    return false;
  }

  /**
   * 通过滚动加载
   */
  private static async paginateByScroll(
    browser: BrowserService,
    waitAfter: number,
  ): Promise<boolean> {
    try {
      await browser.scrollPage(2, 800);
      await ListCrawler.delay(waitAfter);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 延迟
   */
  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
