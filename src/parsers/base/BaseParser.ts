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
    return this.findJobTitleInRefs(refs, '');
  }

  /**
   * 智能查找职位标题（改进版）
   * 优先从 heading 中查找，再看 link
   */
  protected findJobTitleInRefs(refs: Record<string, any>, tree: string): string {
    // 需要排除的导航/页脚文本关键词
    const skipKeywords = [
      'Skip', 'Manage', 'FAQ', 'Privacy', 'Terms', 'Cookie', 'Careers',
      'Sign in', 'Sign up', 'Log in', 'Register', 'Home', 'Menu',
      'interview tips', 'recruitment process', 'About', 'Contact',
      'Learn more', 'Join us', 'Apply now', 'Search', 'Footer',
      'Select Country', 'Select Location',
      // 页脚法律/安全链接
      'Security', 'vulnerability', 'notification', 'Accessibility',
      'SpeakUp', 'Fraud alert', 'Terms of use', 'Cookie policy',
      'Cookie settings', 'Privacy notice',
      // 社交媒体/品牌
      'LinkedIn', 'Instagram', 'Facebook', 'Youtube', 'Glassdoor',
      'opens in a new window',
      // 导航菜单
      'Insights', 'Industries', 'Services', 'News', 'Investors',
    ];

    const isNavText = (text: string): boolean => {
      const lower = text.toLowerCase();
      return skipKeywords.some(kw => lower.includes(kw.toLowerCase()));
    };

    // 1. 优先从 heading 中查找（h1 最重要）
    const headings: Array<{ ref: string; name: string; level: number }> = [];
    for (const [ref, info] of Object.entries(refs)) {
      if (info.role === 'heading' && info.name && info.name.length > 5 && !isNavText(info.name)) {
        headings.push({ ref, name: info.name.split('•')[0].trim(), level: parseInt(ref.slice(1)) });
      }
    }

    // 取 ref 编号最小的 heading（通常是页面主标题）
    if (headings.length > 0) {
      headings.sort((a, b) => a.level - b.level);
      return headings[0].name;
    }

    // 2. 从页面文本中查找 title 标签或特定模式
    if (tree) {
      // 尝试从 tree 文本中提取“Job Title”或“Position”标签后的内容
      const titlePatterns = [
        /(?:Job\s+Title|Position|Role)[:\s]+([^\n]{5,80})/i,
        /heading\s+"([^"]{5,80})"/,  // tree 中的 heading 元素
      ];
      for (const p of titlePatterns) {
        const m = tree.match(p);
        if (m && !isNavText(m[1])) {
          return m[1].trim();
        }
      }
    }

    // 3. 从 link 中查找——但要智能过滤，避免选中页脚链接
    // 策略：在中间 ref 编号范围找合适长度的 link（排除开头的导航和末尾的页脚）
    const allRefs = Object.entries(refs);
    const totalRefs = allRefs.length;

    // 只在中间 60% 的 ref 中查找（跳过前 20% 导航和后 20% 页脚）
    const startIdx = Math.floor(totalRefs * 0.15);
    const endIdx = Math.floor(totalRefs * 0.80);

    let bestTitle = '';
    let bestScore = 0;

    for (const [ref, info] of allRefs) {
      const refNum = parseInt(ref.slice(1));
      if (info.role === 'link' && info.name && info.name.length > 15 && info.name.length < 120 && !isNavText(info.name)) {
        // 优先选择 ref 编号在中间范围的
        const inMiddle = refNum >= startIdx && refNum <= endIdx;
        const score = (inMiddle ? 100 : 0) + Math.min(info.name.length, 80);
        if (score > bestScore) {
          bestTitle = info.name.split('•')[0].trim();
          bestScore = score;
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
   * 从 tree 中提取地点信息
   * 查找 Location/地点 标签后面的文本
   */
  protected extractLocationFromTree(tree: string): string {
    // 先清理 tree 中的 ref 标记，避免 [ref=eXX] 泄漏到结果中
    const cleanTree = tree.replace(/\[ref=e\d+\]/g, '').replace(/\[nth=\d+\]/g, '');

    const patterns = [
      // 优先匹配明确的 Location 标签（排除 textbox/combobox 等 UI 元素）
      /(?:^|\n)\s*Location[:\s]+([A-Za-z][A-Za-z0-9 ,/\-]+)/im,
      /LocationName[:\s]*([A-Za-z][A-Za-z0-9 ,/\-]+)/i,
      /Work Location[:\s]*([A-Za-z][A-Za-z0-9 ,/\-]+)/i,
      /Office Location[:\s]*([A-Za-z][A-Za-z0-9 ,/\-]+)/i,
      /地点[：:\s]*([^\n]{2,60})/,
    ];

    for (const pattern of patterns) {
      const match = cleanTree.match(pattern);
      if (match) {
        let loc = match[1].trim();
        // 排除无意义值
        if (
          loc.toLowerCase().includes('select') ||
          loc.toLowerCase().includes('textbox') ||
          loc.toLowerCase().includes('combobox') ||
          loc.toLowerCase().includes('button') ||
          loc.length < 3
        ) {
          continue;
        }
        // 截断太长的内容
        if (loc.length > 80) loc = loc.substring(0, 80);
        return loc;
      }
    }

    return '';
  }

  /**
   * 从 description 文本中提取地点
   * 处理 Capgemini 等网站把 "LocationXXX" 直接拼接在 JD 末尾的情况
   */
  protected extractLocationFromDescription(description: string): string {
    const patterns = [
      /Location\s*([A-Z][A-Za-z0-9 ,/\-]+?)(?:\s*(?:Business|Brand|Department|Professional|Engineering|Experience))/i,
      /Location\s*:?\s*([A-Z][A-Za-z0-9 ,/\-]{3,60})/i,
    ];
    for (const p of patterns) {
      const m = description.match(p);
      if (m) {
        let loc = m[1].trim();
        if (loc.length > 3 && !loc.toLowerCase().includes('select')) {
          if (loc.length > 80) loc = loc.substring(0, 80);
          return loc;
        }
      }
    }
    return '';
  }

  /**
   * 从页面文本中提取结构化元数据
   * 包括发布日期、截止日期、职位类型、薪资
   */
  protected extractJobMetadata(tree: string, description: string): {
    postDate: string;
    deadLine: string;
    jobType: string;
    salary: string;
  } {
    const text = tree + '\n' + description;

    // 提取发布日期
    let postDate = '';
    const postDatePatterns = [
      /Posted\s+(?:on\s*)?\s*(\d{1,2}\s+\w+\s+\d{4})/i,       // Posted on 07 Nov 2025 或 Posted on07 Nov 2025
      /Posted\s*on\s*(\d{1,2}\s*\w+\s*\d{4})/i,               // Posted on07 Nov 2025 (无空格)
      /Post(?:ed)?\s*Date[:\s]*(\d{4}[\-/]\d{1,2}[\-/]\d{1,2})/i,
      /Post(?:ed)?\s*Date[:\s]*(\d{1,2}[\-/]\d{1,2}[\-/]\d{4})/i,
      /Date\s+Posted[:\s]*(\d{1,2}\s+\w+\s+\d{4})/i,
      /发布日期[：:\s]*(\d{4}[\-/]\d{1,2}[\-/]\d{1,2})/,
      /Posting\s+Date[:\s]*(\d{1,2}\s+\w+\s+\d{4})/i,
      /Posting\s+Date[:\s]*(\w+\s+\d{1,2},?\s+\d{4})/i,
    ];
    for (const p of postDatePatterns) {
      const m = text.match(p);
      if (m) { postDate = m[1].trim(); break; }
    }

    // 提取截止日期
    let deadLine = '';
    const deadLinePatterns = [
      /Apply\s+Before[:\s]*(\d{1,2}\s+\w+\s+\d{4})/i,
      /Deadline[:\s]*(\d{4}[\-/]\d{1,2}[\-/]\d{1,2})/i,
      /Deadline[:\s]*(\d{1,2}\s+\w+\s+\d{4})/i,
      /Closing\s+Date[:\s]*(\d{1,2}\s+\w+\s+\d{4})/i,
      /截止日期[：:\s]*(\d{4}[\-/]\d{1,2}[\-/]\d{1,2})/,
      /Expir(?:es|y|ation)[:\s]*(\d{1,2}\s+\w+\s+\d{4})/i,
    ];
    for (const p of deadLinePatterns) {
      const m = text.match(p);
      if (m) { deadLine = m[1].trim(); break; }
    }

    // 提取职位类型（支持无空格拼接，如 "Contract typePermanent"）
    let jobType = '';
    const jobTypePatterns = [
      /Contract\s*(?:type)?\s*(Full[\s-]?time|Part[\s-]?time|Contract|Permanent|Temporary|Intern(?:ship)?)/i,
      /(?:Job|Employment|Work)\s*Type\s*:?\s*(Full[\s-]?time|Part[\s-]?time|Contract|Permanent|Temporary|Intern(?:ship)?)/i,
      /(?:Schedule)\s*:?\s*(Full[\s-]?time|Part[\s-]?time)/i,
      /职位类型[：:\s]*([^\n]{2,20})/,
    ];
    for (const p of jobTypePatterns) {
      const m = text.match(p);
      if (m) { jobType = m[1].trim(); break; }
    }

    // 提取薪资
    let salary = '';
    const salaryPatterns = [
      /(?:Salary|Pay|Compensation)[:\s]*([\$€£¥]?[\d,.]+\s*[-–to]+\s*[\$€£¥]?[\d,.]+(?:\s*(?:per|a|\/)\s*(?:year|month|hour|annum))?)/i,
      /(?:Salary|Pay|Base\s*Pay)[:\s]*([^\n]{5,50})/i,
      /薪资[：:\s]*([^\n]{3,30})/,
    ];
    for (const p of salaryPatterns) {
      const m = text.match(p);
      if (m) { salary = m[1].trim(); break; }
    }

    return { postDate, deadLine, jobType, salary };
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
      // 等待 SPA 内容加载（很多详情页是动态渲染的）
      await browser.waitForTimeout(1500);

      const { tree, refs } = await browser.getSnapshot({
        interactive: true,
        maxDepth: 5,
      });

      const url = await browser.getCurrentUrl();

      // 提取标题：优先使用指定 ref → headings/links → 页面标题 → description
      let title = '';
      if (options.titleRef && refs[options.titleRef]) {
        title = refs[options.titleRef].name?.split('•')[0]?.trim() || '';
      }
      if (!title) {
        title = this.findJobTitleInRefs(refs, tree);
      }
      // 回退：从浏览器页面标题中提取（如 "Lead Analog Circuit Designer | Capgemini"）
      if (!title) {
        try {
          const pageTitle = await browser.getTitle();
          if (pageTitle) {
            title = this.extractTitleFromPageTitle(pageTitle);
          }
        } catch { /* ignore */ }
      }

      // 提取地点
      let location = '';
      if (options.locationRef && refs[options.locationRef]) {
        location = refs[options.locationRef].name || '';
      }
      if (!location) {
        location = this.extractLocationFromTree(tree);
      }
      if (!location && title) {
        location = this.extractLocation(title);
      }

      // 智能提取完整的 JD 描述
      const description = await this.extractFullDescription(browser, tree, refs);

      // 从 description 中也尝试提取 location（很多网站把 Location 放在 JD 正文中）
      if (!location) {
        location = this.extractLocationFromDescription(description);
      }

      // 回退：从 description 提取标题（如 "Senior Digital Design Engineer Job Description"）
      if (!title) {
        title = this.extractTitleFromDescription(description);
      }

      // 提取结构化元数据（发布日期、截止日期、职位类型）
      const metadata = this.extractJobMetadata(tree, description);

      // 公司名称
      const company = options.defaultCompany || this.getCompanyName();

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
   * 从浏览器页面标题中提取职位名
   * 处理 "Lead Analog Circuit Designer | Capgemini" 格式
   */
  protected extractTitleFromPageTitle(pageTitle: string): string {
    if (!pageTitle || pageTitle.length < 5) return '';

    // 常见的页面标题格式：Title | Company / Title - Company / Title – Company
    const separators = [' | ', ' - ', ' – ', ' — ', ' · '];
    for (const sep of separators) {
      if (pageTitle.includes(sep)) {
        const parts = pageTitle.split(sep);
        const candidate = parts[0].trim();
        // 过滤导航性质标题
        if (candidate.length > 5 && candidate.length < 120 &&
            !candidate.toLowerCase().includes('career') &&
            !candidate.toLowerCase().includes('job search') &&
            !candidate.toLowerCase().includes('home')) {
          return candidate;
        }
      }
    }

    // 没有分隔符的情况下，若整个标题长度合适就直接用
    if (pageTitle.length > 5 && pageTitle.length < 120) {
      return pageTitle.trim();
    }

    return '';
  }

  /**
   * 从 description 文本中提取职位标题
   * 处理 "Senior Digital Design Engineer Job Description" 格式
   */
  private extractTitleFromDescription(description: string): string {
    if (!description) return '';

    const patterns = [
      // "XXX Job Description" — 标题在 "Job Description" 之前
      /^(.{10,100}?)\s*Job\s+Description/i,
      // "Job Title: XXX" 或 "Position: XXX"
      /(?:Job\s+Title|Position|Role)\s*:\s*(.{5,100}?)(?:\n|$)/i,
      // description 以实际 JD 内容开头 "Job Description:We are seeking a Lead XXX"
      /Job\s+Description\s*:?\s*We\s+are\s+(?:seeking|looking\s+for)\s+(?:a\s+|an\s+)?(.{10,80}?)(?:\s+with\b|\s+who\b|\s+to\b|\.)/i,
    ];

    for (const p of patterns) {
      const m = description.match(p);
      if (m) {
        const candidate = m[1].trim();
        if (candidate.length > 5 && candidate.length < 120) {
          return candidate;
        }
      }
    }

    return '';
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
   * 【推荐】从列表页收集所有职位链接的 URL
   * 在列表页调用，提取每个 job ref 的 href，返回 {ref, name, url}[] 数组。
   * 之后可以用 browser.navigate(url) 直接访问每个详情页，
   * 避免 click+goBack 导致的 ref 失效问题。
   *
   * 用法示例（在生成的 parser 中）:
   * ```
   *   const jobRefs = Object.entries(refs).filter(...);
   *   const jobLinks = await this.collectJobLinks(browser, jobRefs);
   *   const listUrl = await browser.getCurrentUrl(); // 保存列表页 URL
   *   for (const link of jobLinks.slice(0, maxItems)) {
   *     await browser.navigate(link.url);
   *     await this.delay(2000);
   *     const detail = await this.extractDetailFields(browser);
   *     jobs.push(this.createJobData({ job_title: link.parsedTitle, ...detail }));
   *   }
   * ```
   */
  protected async collectJobLinks(
    browser: BrowserService,
    jobRefEntries: Array<[string, any]>
  ): Promise<Array<{ ref: string; name: string; url: string }>> {
    const links: Array<{ ref: string; name: string; url: string }> = [];
    const baseUrl = await browser.getCurrentUrl();

    for (const [refId, refInfo] of jobRefEntries) {
      try {
        const href = await browser.getAttribute(`@${refId}`, 'href');
        if (href) {
          // 将相对 URL 转换为绝对 URL
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
   * 【推荐】提取详情页的所有标准字段
   * 这是生成的解析器在进入详情页后提取数据的推荐方式。
   * 自动提取 description、post_date、job_type、salary、location 等字段。
   *
   * 用法示例（在生成的 parser 中）:
   * ```
   *   await browser.navigate(link.url); // 直接导航到详情页
   *   await this.delay(2000);
   *   const detail = await this.extractDetailFields(browser);
   *   const job = this.createJobData({
   *     job_title: titleFromList,       // 列表页已知的字段
   *     company_name: this.getCompanyName(),
   *     job_link: await browser.getCurrentUrl(),
   *     ...detail,                      // 展开详情页提取的字段
   *     source: 'SiteName',
   *   });
   * ```
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
    let description = '';
    let cleanText = '';

    try {
      // 1. 尝试获取主要内容区域文本（最精准）
      const mainText = await browser.getMainContentText();
      if (mainText && mainText.length > 200) {
        cleanText = mainText;
      }
    } catch (e) {
      // ignore
    }

    if (!cleanText) {
      try {
        // 2. 回退到清洁的页面文本
        cleanText = await browser.getCleanPageText();
      } catch (e) {
        try {
          // 3. 最后回退到原始 getPageText
          cleanText = await browser.getPageText();
        } catch (e2) {
          cleanText = '';
        }
      }
    }

    // 4. 获取 accessibility tree 用于元数据提取
    let tree = '';
    try {
      const snapshot = await browser.getSnapshot({ interactive: true, maxDepth: 5 });
      tree = snapshot.tree;
    } catch (e) {
      // ignore
    }

    // 5. 从文本中提取结构化元数据
    const metadata = this.extractJobMetadata(tree, cleanText);

    // 6. 清理 description（移除尾部的元数据标签行）
    description = this.cleanDescriptionText(cleanText);

    // 7. 尝试从文本/tree 中提取 location
    let location = this.extractLocationFromTree(tree);
    if (!location) {
      location = this.extractLocationFromDescription(description);
    }

    // 8. 提取 job_title（从 heading 或浏览器标题）
    let jobTitle = '';
    try {
      const pageTitle = await browser.getTitle();
      if (pageTitle) {
        jobTitle = this.extractTitleFromPageTitle(pageTitle);
      }
    } catch (e) {
      // ignore
    }

    return {
      description,
      post_date: metadata.postDate,
      dead_line: metadata.deadLine,
      job_type: metadata.jobType,
      salary: metadata.salary,
      location,
      job_title: jobTitle,
    };
  }

  /**
   * 清理 description 文本
   * 移除常见的页面尾部噪音（元数据标签、品牌信息等）
   */
  private cleanDescriptionText(text: string): string {
    if (!text) return '';
    let cleaned = text;

    // 移除常见的 JD 末尾元数据行
    const trailingPatterns = [
      /\s*Ref\.?\s*code\s*\w+.*/gi,
      /\s*Posted\s+on\s*\d{1,2}\s+\w+\s+\d{4}.*/gi,
      /\s*Experience\s+level\s*\w+.*/gi,
      /\s*Contract\s+type\s*\w+.*/gi,
      /\s*Business\s+unit\s+.*/gi,
      /\s*Professional\s+communities\s+.*/gi,
      /\s*Brand\s+.{0,50}$/gi,
      /\s*Department\s+.{0,50}$/gi,
      /\s*Learn more about .*$/gi,
      /\s*Why join .*$/gi,
      /\s*Understand the recruitment process.*$/gi,
      /\s*Get ready for the big day.*$/gi,
      /\s*Cookie settings.*$/gi,
      /\s*Our brands:.*$/gi,
      /\s*©.*All rights reserved\.?.*$/gi,
    ];

    for (const pattern of trailingPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // 截取 JD 核心内容（尝试定位起始点）
    const jdStartPatterns = [
      /(?:Job\s+)?Description\s*:?/i,
      /About\s+this\s+role/i,
      /What\s+you['']ll\s+do/i,
      /Your\s+responsibilities/i,
      /Role\s+(?:Summary|Overview|Description)/i,
      /Position\s+(?:Summary|Overview|Description)/i,
      /Key\s+Responsibilities/i,
      /We\s+are\s+(?:seeking|looking\s+for)/i,
    ];

    let jdStart = -1;
    for (const pattern of jdStartPatterns) {
      const match = cleaned.search(pattern);
      if (match !== -1 && (jdStart === -1 || match < jdStart)) {
        jdStart = match;
      }
    }

    if (jdStart > 0 && jdStart < cleaned.length * 0.5) {
      cleaned = cleaned.substring(jdStart);
    }

    // 截断尾部无关内容
    const endPatterns = [
      /\bSimilar\s+Jobs\b/i,
      /\bLearn\s+more\s+about\b/i,
      /\bWhy\s+join\b/i,
      /\bOur\s+brands\b/i,
      /\bCookie\s+settings\b/i,
      /\b©\s*\w+/i,
    ];

    for (const pattern of endPatterns) {
      const match = cleaned.search(pattern);
      if (match !== -1 && match > 200) {
        cleaned = cleaned.substring(0, match);
        break;
      }
    }

    // 最终清理
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    if (cleaned.length > 8000) {
      cleaned = cleaned.substring(0, 8000) + '...';
    }

    return cleaned;
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
   * 彻底移除 JS/CSS/HTML 垃圾
   */
  private cleanPageText(pageText: string): string {
    let cleaned = pageText;

    // === 第一步：移除 JS/CSS 代码块 ===
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');           // CSS 注释
    cleaned = cleaned.replace(/\{[^}]{20,}\}/g, '');              // CSS 规则（长的花括号块）
    cleaned = cleaned.replace(/\.[a-z][a-z-]*\s*\{[^}]*\}/gi, ''); // CSS 类
    cleaned = cleaned.replace(/#[a-z][a-z-]*\s*\{[^}]*\}/gi, ''); // CSS ID
    cleaned = cleaned.replace(/@media\s+[^{]*\{[\s\S]*?\}\s*\}/gi, ''); // @media
    cleaned = cleaned.replace(/@font-face\s*\{[\s\S]*?\}/gi, '');

    // 移除 JS 代码特征
    cleaned = cleaned.replace(/(?:var|let|const|function|window|document)\s+\w+\s*[=({][\s\S]{0,500}?[;})]/g, '');
    cleaned = cleaned.replace(/\$\(document\)\.ready\([\s\S]*?\)\s*;?/g, '');
    cleaned = cleaned.replace(/jQuery\([\s\S]*?\)\s*;?/g, '');
    cleaned = cleaned.replace(/fbq\([^)]*\)\s*;?/g, '');
    cleaned = cleaned.replace(/gtag\([^)]*\)\s*;?/g, '');

    // 移除 HTML 标签
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');

    // 移除 URL 和追踪脚本碎片
    cleaned = cleaned.replace(/https?:\/\/\S+/g, '');
    cleaned = cleaned.replace(/window\.\w+\s*=[\s\S]*?;/g, '');

    // === 第二步：移除导航和无关内容 ===
    const skipPatterns = [
      /Skip to (?:main )?content/gi,
      /Menu\s*×/gi,
      /Apply\s+(?:Now|with\s+\w+)/gi,
      /Back\s+to\s+results/gi,
      /Share\s+this\s+job/gi,
      /Cookie\s*(?:Policy|Banner|Settings)?/gi,
      /Privacy\s+(?:Policy|Notice)/gi,
      /Terms\s+of\s+(?:Use|Service)/gi,
      /© \w+,?\s*\d{4}\.\s*All rights reserved\.?/gi,
      /All rights reserved\.?/gi,
    ];

    for (const pattern of skipPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // === 第三步：定位 JD 核心内容 ===
    const jdStartPatterns = [
      /(?:Job\s+)?Description\s*:/i,           // "Job Description:" 或 "Description:" （有冒号）
      /(?:Job\s+)?Description(?=\s|[A-Z])/i,   // "Description " 或 "DescriptionLead"（后跟空格或大写字母）
      /About\s+this\s+role/i,
      /What\s+you['']ll\s+do/i,
      /Your\s+responsibilities/i,
      /Role\s+(?:Summary|Overview|Description)/i,
      /Position\s+(?:Summary|Overview|Description)/i,
      /Relevant\s*Tasks/i,
      /Key\s+Responsibilities/i,
    ];

    let jdStart = -1;
    for (const pattern of jdStartPatterns) {
      const match = cleaned.search(pattern);
      if (match !== -1 && (jdStart === -1 || match < jdStart)) {
        jdStart = match;
      }
    }

    if (jdStart !== -1) {
      cleaned = cleaned.substring(jdStart);
    }

    // 截断末尾无关内容
    const endPatterns = [
      /\bSimilar\s+Jobs\b/i,
      /\bLearn\s+more\s+about\b/i,
      /\bWhy\s+join\b/i,
      /\bInsights\s+Industries\s+Services\b/i,
      /\bSearch\s+Jobs\b/i,
      /\bFooter\b/i,
      /\bOur\s+brands:/i,
    ];

    for (const pattern of endPatterns) {
      const match = cleaned.search(pattern);
      if (match !== -1 && match > 200) { // 确保不会截掉太多
        cleaned = cleaned.substring(0, match);
        break;
      }
    }

    // === 第四步：最终清理 ===
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/\s+\./g, '.');
    cleaned = cleaned.replace(/\s+,/g, ',');
    cleaned = cleaned.replace(/\s{2,}/g, ' ');

    if (cleaned.length > 8000) {
      cleaned = cleaned.substring(0, 8000) + '...';
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
