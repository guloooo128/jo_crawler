import type { Parser } from './Parser.js';
import type { BrowserService } from '../../services/BrowserService.js';
import type { JobData, ParseOptions, ParserMetadata } from '../../models/JobData.js';
import { generateJobId } from '../../utils/jobId.js';
import { TextCleaner } from '../helpers/TextCleaner.js';
import { FieldParser } from '../helpers/FieldParser.js';
import { DetailExtractor } from '../helpers/DetailExtractor.js';

/**
 * 基础解析器抽象类（重构版）
 *
 * 核心职责：
 *   - 定义 Parser 接口的默认实现
 *   - 提供 createJobData() 工厂方法
 *   - 作为生成解析器的基类
 *
 * 文本清洗 → TextCleaner
 * 字段提取 → FieldParser
 * 列表爬取 → ListCrawler
 * 详情提取 → DetailExtractor
 *
 * ⚠️ 向后兼容：所有旧方法保留为委托方法，已有的生成解析器无需修改。
 */
export abstract class BaseParser implements Parser {
  abstract metadata: ParserMetadata;

  // ════════════════════ 核心接口 ════════════════════

  /**
   * 判断是否可以解析此页面
   * 默认实现：检查域名是否匹配
   */
  canParse(snapshot: string, url: string): boolean {
    const domain = this.extractDomain(url);
    return this.matchDomain(domain);
  }

  /**
   * 解析页面 - 子类必须实现
   */
  abstract parse(browser: BrowserService, options: ParseOptions): Promise<JobData[]>;

  /**
   * 获取默认解析选项
   */
  getDefaults(): Partial<ParseOptions> {
    return {
      maxItems: 50,
      followPagination: false,
      includeDetails: true,
      timeout: 30000,
    };
  }

  // ════════════════════ 数据构建 ════════════════════

  /**
   * 创建 JobData 对象（带默认值 + 自动生成 job_id）
   */
  protected createJobData(defaults: Partial<JobData> = {}): JobData {
    const job: JobData = {
      job_id: '',
      job_title: defaults.job_title || '',
      company_name: defaults.company_name || '',
      location: defaults.location || '',
      job_link: defaults.job_link || '',
      post_date: defaults.post_date || '',
      dead_line: defaults.dead_line || '',
      job_type: defaults.job_type || '',
      description: defaults.description || '',
      salary: defaults.salary || '',
      source: this.metadata.name,
      extracted_at: new Date().toISOString(),
      ...defaults,
    };
    if (!job.job_id) {
      job.job_id = generateJobId(job);
    }
    return job;
  }

  // ════════════════════ 域名匹配 ════════════════════

  /**
   * 从 URL 提取域名
   */
  protected extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  /**
   * 匹配域名（支持通配符 *.example.com）
   */
  protected matchDomain(domain: string): boolean {
    const parserDomain = this.metadata.domain;
    if (parserDomain === domain) return true;
    if (parserDomain.startsWith('*.')) {
      const baseDomain = parserDomain.slice(2);
      return domain === baseDomain || domain.endsWith('.' + baseDomain);
    }
    return false;
  }

  // ════════════════════ 工具方法 ════════════════════

  /**
   * 延迟执行
   */
  protected async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ════════════════════════════════════════════════════
  //   向后兼容委托方法
  //   以下方法委托到 TextCleaner / FieldParser / DetailExtractor
  //   确保已有的生成解析器无需任何修改即可运行
  // ════════════════════════════════════════════════════

  // ── TextCleaner 委托 ──

  /** @deprecated 使用 TextCleaner.cleanText() */
  protected cleanText(text: string): string {
    return TextCleaner.cleanText(text);
  }

  // ── FieldParser 委托 ──

  /** @deprecated 使用 FieldParser.extractRefs() */
  protected extractRefs(snapshot: string): string[] {
    return FieldParser.extractRefs(snapshot);
  }

  /** @deprecated 使用 FieldParser.findJobTitleInRefs() */
  protected findTitleInRefs(refs: Record<string, any>): string {
    return FieldParser.findJobTitleInRefs(refs, '');
  }

  /** @deprecated 使用 FieldParser.findJobTitleInRefs() */
  protected findJobTitleInRefs(refs: Record<string, any>, tree: string): string {
    return FieldParser.findJobTitleInRefs(refs, tree);
  }

  /** @deprecated 使用 FieldParser.extractLocation() */
  protected extractLocation(text: string): string {
    return FieldParser.extractLocation(text);
  }

  /** @deprecated 使用 FieldParser.extractLocationFromTree() */
  protected extractLocationFromTree(tree: string): string {
    return FieldParser.extractLocationFromTree(tree);
  }

  /** @deprecated 使用 FieldParser.extractLocationFromDescription() */
  protected extractLocationFromDescription(description: string): string {
    return FieldParser.extractLocationFromDescription(description);
  }

  /** @deprecated 使用 FieldParser.extractJobMetadata() */
  protected extractJobMetadata(tree: string, description: string): {
    postDate: string;
    deadLine: string;
    jobType: string;
    salary: string;
  } {
    return FieldParser.extractJobMetadata(tree, description);
  }

  /** @deprecated 使用 FieldParser.extractTitleFromPageTitle() */
  protected extractTitleFromPageTitle(pageTitle: string): string {
    return FieldParser.extractTitleFromPageTitle(pageTitle);
  }

  /** @deprecated 使用 FieldParser.getCompanyName() */
  protected getCompanyName(): string {
    return FieldParser.getCompanyName(this.metadata.domain);
  }

  /** @deprecated 使用 FieldParser.findJobCardRefs() */
  protected findJobCardRefs(tree: string, refs: Record<string, any>): string[] {
    return FieldParser.findJobCardRefs(tree, refs);
  }

  // ── 列表页辅助（委托到 ListCrawler） ──

  /**
   * 收集职位链接 URL
   * @deprecated 使用 ListCrawler.collectJobLinks()
   */
  protected async collectJobLinks(
    browser: BrowserService,
    jobRefEntries: Array<[string, any]>
  ): Promise<Array<{ ref: string; name: string; url: string }>> {
    const { ListCrawler } = await import('../helpers/ListCrawler.js');
    return ListCrawler.collectJobLinks(browser, jobRefEntries);
  }

  // ── DetailExtractor 委托 ──

  /**
   * 从详情页提取全部标准字段
   * @deprecated 使用 DetailExtractor.extract()
   */
  protected async extractDetailFields(browser: BrowserService): Promise<{
    description: string;
    post_date: string;
    dead_line: string;
    job_type: string;
    salary: string;
    location: string;
    job_title: string;
  }> {
    const result = await DetailExtractor.extract(browser);
    return result;
  }

  /**
   * 从当前页面提取完整职位数据
   * @deprecated 使用 DetailExtractor.extract() + createJobData()
   */
  protected async extractJobFromPage(
    browser: BrowserService,
    options: {
      titleRef?: string;
      locationRef?: string;
      descriptionRef?: string;
      defaultCompany?: string;
    } = {}
  ): Promise<JobData | null> {
    try {
      await browser.waitForTimeout(1500);

      const { tree, refs } = await browser.getSnapshot({
        interactive: true,
        maxDepth: 5,
      });

      const url = await browser.getCurrentUrl();

      // 提取标题
      let title = '';
      if (options.titleRef && refs[options.titleRef]) {
        title = refs[options.titleRef].name?.split('•')[0]?.trim() || '';
      }
      if (!title) {
        title = FieldParser.findJobTitleInRefs(refs, tree);
      }
      if (!title) {
        try {
          const pageTitle = await browser.getTitle();
          if (pageTitle) {
            title = FieldParser.extractTitleFromPageTitle(pageTitle);
          }
        } catch { /* ignore */ }
      }

      // 提取地点
      let location = '';
      if (options.locationRef && refs[options.locationRef]) {
        location = refs[options.locationRef].name || '';
      }
      if (!location) {
        location = FieldParser.extractLocationFromTree(tree);
      }
      if (!location && title) {
        location = FieldParser.extractLocation(title);
      }

      // 提取描述
      const description = await DetailExtractor.extractFullDescription(browser, tree, refs);

      // 从 description 中也尝试提取 location
      if (!location) {
        location = FieldParser.extractLocationFromDescription(description);
      }

      // 回退：从 description 提取标题
      if (!title) {
        title = FieldParser.extractTitleFromDescription(description);
      }

      // 提取元数据
      const metadata = FieldParser.extractJobMetadata(tree, description);

      // 公司名称
      const company = options.defaultCompany || FieldParser.getCompanyName(this.metadata.domain);

      return this.createJobData({
        job_title: title || '',
        company_name: company,
        location: location || '',
        job_link: url,
        post_date: metadata.postDate,
        dead_line: metadata.deadLine,
        job_type: metadata.jobType,
        description,
        salary: metadata.salary,
        source: this.metadata.name,
      });
    } catch (error: any) {
      console.error('❌ 提取职位数据失败:', error.message);
      return null;
    }
  }

  /**
   * 智能提取完整的职位描述
   * @deprecated 使用 DetailExtractor.extractFullDescription()
   */
  protected async extractFullDescription(
    browser: BrowserService,
    tree: string,
    refs: Record<string, any>
  ): Promise<string> {
    return DetailExtractor.extractFullDescription(browser, tree, refs);
  }
}
