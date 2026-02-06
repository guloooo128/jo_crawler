import type { Parser } from './Parser.js';
import type { BrowserService } from '../../services/BrowserService.js';
import type { JobData, ParseOptions, ParserMetadata } from '../../models/JobData.js';

/**
 * 基础解析器抽象类
 * 提供通用的解析器功能
 */
export abstract class BaseParser implements Parser {
  abstract metadata: ParserMetadata;

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

  /**
   * 从 URL 提取域名
   */
  protected extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return '';
    }
  }

  /**
   * 匹配域名（支持通配符）
   */
  protected matchDomain(domain: string): boolean {
    const parserDomain = this.metadata.domain;

    // 精确匹配
    if (parserDomain === domain) {
      return true;
    }

    // 通配符匹配 (*.example.com)
    if (parserDomain.startsWith('*.')) {
      const baseDomain = parserDomain.slice(2);
      return domain === baseDomain || domain.endsWith('.' + baseDomain);
    }

    return false;
  }

  /**
   * 从快照中提取所有 refs
   */
  protected extractRefs(snapshot: string): string[] {
    const refPattern = /\[ref=(e\d+)\]/g;
    const refs: string[] = [];
    let match;

    while ((match = refPattern.exec(snapshot)) !== null) {
      refs.push(match[1]);
    }

    return refs;
  }

  /**
   * 清理文本（去除多余空白）
   */
  protected cleanText(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n');
  }

  /**
   * 创建 JobData 对象（带默认值）
   */
  protected createJobData(defaults: Partial<JobData> = {}): JobData {
    return {
      title: defaults.title || '',
      company: defaults.company || '',
      location: defaults.location || '',
      description: defaults.description || '',
      requirements: defaults.requirements || [],
      url: defaults.url || '',
      source: this.metadata.name,
      extractedAt: new Date(),
      ...defaults,
    };
  }

  /**
   * 延迟执行
   */
  protected async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 从 refs 中智能查找标题
   * 优先选择最长的 link 或 heading
   */
  protected findTitleInRefs(refs: Record<string, any>): string {
    let bestTitle = '';
    let maxLength = 0;

    // 优先从 link 中查找
    for (const [ref, info] of Object.entries(refs)) {
      if (info.role === 'link' && info.name && info.name.length > maxLength) {
        // 排除导航链接
        const skipKeywords = ['Skip', 'Manage', 'FAQ', 'Privacy', 'Terms', 'Cookie', 'Careers'];
        if (!skipKeywords.some(kw => info.name.includes(kw))) {
          bestTitle = info.name.split('•')[0].trim();
          maxLength = info.name.length;
        }
      }
    }

    // 如果没找到，尝试 heading
    if (!bestTitle) {
      for (const [ref, info] of Object.entries(refs)) {
        if (info.role === 'heading' && info.name) {
          bestTitle = info.name;
          break;
        }
      }
    }

    return bestTitle;
  }

  /**
   * 从文本中提取地点（支持多种格式）
   */
  protected extractLocation(text: string): string {
    const patterns = [
      /([A-Z][a-z]+,\s*[A-Z]{2})/,           // New York, NY
      /([A-Z][a-z]+,\s*[A-Z][a-z]+)/,          // New York, United States
      /([A-Z][a-z]+\s+-?\s*[A-Z][a-z]+)/,      // New York - NY
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return '';
  }

  /**
   * 从 tree 或 refs 中提取职位数据（通用方法）
   * 适用于大多数招聘网站的详情页
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
      const { tree, refs } = await browser.getSnapshot({
        interactive: true,
        maxDepth: 3,
      });

      const url = await browser.getCurrentUrl();

      // 提取标题
      let title = '';
      if (options.titleRef && refs[options.titleRef]) {
        title = refs[options.titleRef].name?.split('•')[0]?.trim() || '';
      }
      if (!title) {
        title = this.findTitleInRefs(refs);
      }

      // 提取地点
      let location = '';
      if (options.locationRef && refs[options.locationRef]) {
        location = refs[options.locationRef].name || '';
      }
      if (!location) {
        // 从 tree 中查找
        location = this.extractLocation(tree);
      }
      if (!location && title) {
        // 从标题文本中提取
        location = this.extractLocation(title);
      }

      // 智能提取完整的 JD 描述
      const description = await this.extractFullDescription(browser, tree, refs);

      // 公司名称
      const company = options.defaultCompany || this.getCompanyName();

      return this.createJobData({
        title: title || 'Unknown Position',
        company,
        location: location || 'Unknown Location',
        description,
        url,
        source: this.metadata.name,
      });
    } catch (error: any) {
      console.error('❌ 提取职位数据失败:', error.message);
      return null;
    }
  }

  /**
   * 获取公司名称（子类可以重写）
   */
  protected getCompanyName(): string {
    const domain = this.metadata.domain;

    if (domain.includes('oraclecloud')) return 'JPMorgan Chase';
    if (domain.includes('microsoft')) return 'Microsoft';
    if (domain.includes('google')) return 'Google';
    if (domain.includes('amazon')) return 'Amazon';
    if (domain.includes('apple')) return 'Apple';
    if (domain.includes('netflix')) return 'Netflix';
    if (domain.includes('meta')) return 'Meta';

    // 从域名提取
    const parts = domain.split('.');
    if (parts.length >= 2) {
      return parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1);
    }

    return 'Unknown Company';
  }

  /**
   * 从快照中查找所有职位卡片的 refs
   * 适用于列表页
   */
  protected findJobCardRefs(tree: string, refs: Record<string, any>): string[] {
    const jobRefs: string[] = [];

    for (const [ref, info] of Object.entries(refs)) {
      // 查找 link 类型，且名称较长的（通常是职位卡片）
      if (info.role === 'link' && info.name && info.name.length > 30) {
        // 排除导航链接
        const skipKeywords = ['Skip', 'Manage', 'View More', 'FAQ', 'Privacy', 'Terms', 'Cookie', 'Careers'];
        if (!skipKeywords.some(kw => info.name.includes(kw))) {
          jobRefs.push(ref);
        }
      }
    }

    return jobRefs.sort((a, b) => {
      const numA = parseInt(a.slice(1));
      const numB = parseInt(b.slice(1));
      return numA - numB;
    });
  }

  /**
   * 智能提取完整的职位描述
   * 尝试多种方法获取 JD 内容
   */
  protected async extractFullDescription(
    browser: BrowserService,
    tree: string,
    refs: Record<string, any>
  ): Promise<string> {
    try {
      // 方法1: 获取页面的完整文本内容
      const pageText = await browser.getPageText();

      if (pageText && pageText.length > 200) {
        // 清理页面文本
        return this.cleanPageText(pageText);
      }
    } catch (error) {
      console.debug('获取页面文本失败:', error);
    }

    // 方法2: 从 tree 中提取段落
    const sections = this.extractJDSections(tree);
    if (sections.length > 0) {
      return sections.join('\n\n');
    }

    // 方法3: 返回清理后的 tree
    return this.cleanTreeForDescription(tree);
  }

  /**
   * 清理页面文本，提取 JD 内容
   */
  private cleanPageText(pageText: string): string {
    let cleaned = pageText;

    // 移除 CSS 样式
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, ''); // CSS 注释
    cleaned = cleaned.replace(/\{[^}]*\}/g, '');       // CSS 规则
    cleaned = cleaned.replace(/\.[a-z-]+\s*\{/gi, ''); // CSS 类名

    // 移除导航和页面元素
    const skipPatterns = [
      /Skip to main content/gi,
      /Menu\s*×/gi,
      /Close/gi,
      /Apply\s+Now/gi,
      /Apply\s+with\s+\w+/gi,
      /Back\s+to\s+results/gi,
      /Share\s+this\s+job/gi,
      /Cookie/gi,
      /Privacy\s+Policy/gi,
      /Terms\s+of\s+Use/gi,
      /Job\s+Identification/gi,
      /Job\s+Category/gi,
      /Business\s+Unit/gi,
      /Posting\s+Date/gi,
      /Locations/gi,
      /Apply\s+Before/gi,
      /Job\s+Schedule/gi,
      /Base\s+Pay/gi,
    ];

    for (const pattern of skipPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // 保留核心 JD 内容
    // 查找 JD 开始和结束标记
    const jdStartPatterns = [
      /Job Description/i,
      /Description/i,
      /About this role/i,
      /What you'll do/i,
      /Your responsibilities/i,
    ];

    let jdStart = -1;
    for (const pattern of jdStartPatterns) {
      const match = cleaned.search(pattern);
      if (match !== -1 && (jdStart === -1 || match < jdStart)) {
        jdStart = match;
      }
    }

    if (jdStart !== -1) {
      // 从 JD 开始位置截取
      cleaned = cleaned.substring(jdStart);
    }

    // 移除末尾的无关内容
    const endPatterns = [
      /\s*Similar Jobs/i,
      /\s*\.component-styling-wrapper/i,
      /\s*@media all and/i,
      /\s*@media \(/i,
      /\s*Search Jobs -/i,
      /\s*Profile Sign Out/i,
      /\s*Digital Assistant/i,
      /\s*sitemap/i,
    ];

    for (const pattern of endPatterns) {
      const match = cleaned.search(pattern);
      if (match !== -1) {
        cleaned = cleaned.substring(0, match);
        break; // 找到第一个匹配就停止
      }
    }

    // 清理多余空白
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/\s+\./g, '.'); // 修复句号前的空格
    cleaned = cleaned.replace(/\s+,/g, ',');  // 修复逗号前的空格

    // 限制长度，避免太长
    if (cleaned.length > 10000) {
      cleaned = cleaned.substring(0, 10000) + '...';
    }

    return cleaned.trim();
  }

  /**
   * 从 tree 中提取 JD 相关的段落
   */
  private extractJDSections(tree: string): string[] {
    const sections: string[] = [];
    const paragraphs = tree.split('\n\n');

    for (const para of paragraphs) {
      // 跳过太短的段落
      if (para.length < 50) continue;

      // 跳过导航、按钮等
      if (this.shouldSkipParagraph(para)) continue;

      sections.push(para.trim());
    }

    return sections;
  }

  /**
   * 判断是否应该跳过某个段落
   */
  private shouldSkipParagraph(para: string): boolean {
    const skipPatterns = [
      /^-.*button\s+"/,      // 按钮
      /^-.*link\s+"/,        // 链接
      /^\[ref=/,             // ref 引用
      /^(Skip|Manage|FAQ|Privacy|Terms|Cookie|Apply)/,  // 导航元素
    ];

    return skipPatterns.some(pattern => pattern.test(para));
  }

  /**
   * 清理 tree 用于作为描述
   */
  private cleanTreeForDescription(tree: string): string {
    let cleaned = tree;

    // 移除 ref 标记
    cleaned = cleaned.replace(/\[ref=e\d+\]/g, '');

    // 移除按钮和导航项
    cleaned = cleaned.replace(/- button "[^"]*" \[ref=e\d+\](\s*\[nth=\d+\])?/g, '');
    cleaned = cleaned.replace(/- link\s+"[^"]*"\s*\[ref=e\d+\]/g, '');

    // 清理多余空行
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');

    return cleaned.trim();
  }
}
