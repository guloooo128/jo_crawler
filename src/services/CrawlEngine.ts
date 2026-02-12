/**
 * CrawlEngine — 并发爬取引擎
 *
 * Phase 3 新增：
 * - 浏览器池管理（多个 BrowserService 实例）
 * - p-limit 控制并发度
 * - 统一的爬取结果收集 + 统计
 * - 单 URL 爬取逻辑从 crawl.ts 抽出，便于测试和复用
 */

import pLimit from 'p-limit';
import { BrowserService } from './BrowserService.js';
import { LLMService } from './LLMService.js';
import { DatabaseService } from './DatabaseService.js';
import { ParserRegistry } from '../parsers/registry.js';
import { GenericParser } from '../parsers/base/GenericParser.js';
import type { LinkConfig } from '../models/LinksConfig.js';
import type { JobData } from '../models/JobData.js';

// ============================================================================
// Types
// ============================================================================

export interface CrawlEngineConfig {
  /** 并发数（同时打开的浏览器窗口数），默认 1 */
  concurrency: number;
  /** 每站最大职位数 */
  maxJobs: number;
  /** 最大翻页数 */
  maxPages: number;
  /** 无头模式 */
  headless: boolean;
  /** 详细输出 */
  verbose: boolean;
  /** CDP 端口或 URL，连接已有 Chrome（反爬场景） */
  cdpUrl?: string;
}

export interface SingleCrawlResult {
  url: string;
  domain: string;
  extracted: number;
  inserted: number;
  skipped: number;
  success: boolean;
  error?: string;
  parserName?: string;
}

export interface CrawlSummary {
  totalExtracted: number;
  totalInserted: number;
  totalSkipped: number;
  succeeded: number;
  failed: number;
  results: SingleCrawlResult[];
}

// ============================================================================
// CrawlEngine
// ============================================================================

export class CrawlEngine {
  private llmService: LLMService;
  private registry: ParserRegistry;
  private db: DatabaseService;
  private config: CrawlEngineConfig;
  private browserPool: BrowserService[] = [];

  constructor(
    llmService: LLMService,
    registry: ParserRegistry,
    db: DatabaseService,
    config: CrawlEngineConfig,
  ) {
    this.llmService = llmService;
    this.registry = registry;
    this.db = db;
    this.config = config;
  }

  /**
   * 并发爬取所有 URL
   */
  async crawlAll(linkConfigs: LinkConfig[]): Promise<CrawlSummary> {
    const concurrency = Math.min(this.config.concurrency, linkConfigs.length) || 1;

    console.log(`🚀 并发度: ${concurrency}, 任务数: ${linkConfigs.length}\n`);

    // 创建浏览器池
    await this.initBrowserPool(concurrency);

    const limit = pLimit(concurrency);
    const results: SingleCrawlResult[] = [];
    let taskIndex = 0;

    try {
      const tasks = linkConfigs.map((linkConfig) => {
        const idx = taskIndex++;
        return limit(async () => {
          const browser = this.browserPool[idx % concurrency];
          const result = await this.crawlSingle(browser, linkConfig, idx + 1, linkConfigs.length);
          results.push(result);
          return result;
        });
      });

      await Promise.all(tasks);
    } finally {
      await this.closeBrowserPool();
    }

    return this.summarize(results);
  }

  /**
   * 串行爬取（向后兼容，concurrency=1 时的优化路径）
   */
  async crawlSerial(linkConfigs: LinkConfig[]): Promise<CrawlSummary> {
    const results: SingleCrawlResult[] = [];

    // 只用一个浏览器
    await this.initBrowserPool(1);
    const browser = this.browserPool[0];

    try {
      for (let i = 0; i < linkConfigs.length; i++) {
        const result = await this.crawlSingle(browser, linkConfigs[i], i + 1, linkConfigs.length);
        results.push(result);
      }
    } finally {
      await this.closeBrowserPool();
    }

    return this.summarize(results);
  }

  // ==========================================================================
  // 核心：单 URL 爬取
  // ==========================================================================

  private async crawlSingle(
    browser: BrowserService,
    linkConfig: LinkConfig,
    index: number,
    total: number,
  ): Promise<SingleCrawlResult> {
    const { url, type: configType, maxJobs: configMaxJobs } = linkConfig;
    const actualMaxJobs = configMaxJobs || this.config.maxJobs;
    const pageType = configType === 'auto' ? undefined : configType;
    const domain = this.extractDomain(url);

    const tag = `[${index}/${total}]`;
    console.log(`${tag} 🕷️  开始爬取: ${url}`);

    try {
      // 1. 导航
      await browser.navigate(url);
      await browser.waitForContent(15000, 3);

      // 2. 获取快照
      const { tree } = await browser.getSnapshotWithRetry(
        { interactive: true, maxDepth: 5 },
        5,
        2000,
      );

      // 3. 查找解析器
      let parser = this.registry.findMatchingParser(tree, url, pageType);

      if (!parser) {
        const loadedParser = await this.registry.loadParser(domain, url, pageType);
        if (loadedParser) parser = loadedParser;
      }

      const genericParser = new GenericParser(this.llmService);
      if (!parser) {
        console.log(`${tag} ⚠️  使用通用解析器`);
        parser = genericParser;
      } else {
        console.log(`${tag} ✅ 使用解析器: ${parser.metadata.name}`);
      }

      // 4. 执行解析
      const jobs: JobData[] = await parser.parse(browser, {
        maxItems: actualMaxJobs,
        maxPages: this.config.maxPages,
        followPagination: this.config.maxPages > 1,
        includeDetails: true,
      });

      // 5. 去重 + 入库
      const { newJobs, skippedCount } = this.db.filterNewJobs(jobs);
      const inserted = this.db.saveJobs(newJobs);

      const skipText = skippedCount > 0 ? `, 跳过 ${skippedCount}` : '';
      console.log(`${tag} ✅ 提取 ${jobs.length} → 新增 ${inserted}${skipText}`);

      return {
        url,
        domain,
        extracted: jobs.length,
        inserted,
        skipped: skippedCount,
        success: true,
        parserName: parser.metadata.name,
      };
    } catch (error: any) {
      console.error(`${tag} ❌ 爬取失败: ${error.message}`);
      if (this.config.verbose) {
        console.error(error.stack);
      }
      return {
        url,
        domain,
        extracted: 0,
        inserted: 0,
        skipped: 0,
        success: false,
        error: error.message,
      };
    }
  }

  // ==========================================================================
  // 浏览器池管理
  // ==========================================================================

  private async initBrowserPool(size: number): Promise<void> {
    for (let i = 0; i < size; i++) {
      const browser = new BrowserService(this.llmService);
      await browser.launch({ headless: this.config.headless, cdpUrl: this.config.cdpUrl });
      this.browserPool.push(browser);
    }
    console.log(`🌐 浏览器池已创建 (${size} 个实例)`);
  }

  private async closeBrowserPool(): Promise<void> {
    for (const browser of this.browserPool) {
      try {
        await browser.close();
      } catch { /* ignore */ }
    }
    this.browserPool = [];
  }

  // ==========================================================================
  // 汇总
  // ==========================================================================

  private summarize(results: SingleCrawlResult[]): CrawlSummary {
    const summary: CrawlSummary = {
      totalExtracted: 0,
      totalInserted: 0,
      totalSkipped: 0,
      succeeded: 0,
      failed: 0,
      results,
    };

    for (const r of results) {
      summary.totalExtracted += r.extracted;
      summary.totalInserted += r.inserted;
      summary.totalSkipped += r.skipped;
      if (r.success) summary.succeeded++;
      else summary.failed++;
    }

    return summary;
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }
}
