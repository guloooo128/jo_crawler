/**
 * FieldParser — 字段提取模块
 *
 * 从 BaseParser 中提取的字段解析相关功能。
 * 负责从快照/文本中提取 title、location、postDate、deadLine、jobType、salary 等结构化字段。
 */

/** 需要排除的导航/页脚文本关键词 */
const SKIP_KEYWORDS = [
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

/**
 * 职位元数据提取结果
 */
export interface JobMetadata {
  postDate: string;
  deadLine: string;
  jobType: string;
  salary: string;
}

/**
 * 默认公司名映射表（域名关键词 → 公司名）
 * 可通过 FieldParser.setCompanyMap() 扩展
 */
const DEFAULT_COMPANY_MAP: Record<string, string> = {
  'oraclecloud': 'JPMorgan Chase',
  'microsoft': 'Microsoft',
  'google': 'Google',
  'amazon': 'Amazon',
  'apple': 'Apple',
  'netflix': 'Netflix',
  'meta': 'Meta',
};

export class FieldParser {
  /** 可覆盖的公司名映射表 */
  private static companyMap: Record<string, string> = { ...DEFAULT_COMPANY_MAP };

  /**
   * 扩展/覆盖公司名映射表
   */
  static setCompanyMap(map: Record<string, string>): void {
    FieldParser.companyMap = { ...DEFAULT_COMPANY_MAP, ...map };
  }

  /**
   * 判断文本是否为导航性质
   */
  static isNavText(text: string): boolean {
    const lower = text.toLowerCase();
    return SKIP_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
  }

  /**
   * 智能查找职位标题
   * 策略：headings > 页面中部 links > 页面标题 > description 回退
   */
  static findJobTitleInRefs(refs: Record<string, any>, tree: string = ''): string {
    // 1. 优先从 heading 中查找（h1 最重要）
    const headings: Array<{ ref: string; name: string; level: number }> = [];
    for (const [ref, info] of Object.entries(refs)) {
      if (info.role === 'heading' && info.name && info.name.length > 5 && !FieldParser.isNavText(info.name)) {
        headings.push({ ref, name: info.name.split('•')[0].trim(), level: parseInt(ref.slice(1)) });
      }
    }

    // 取 ref 编号最小的 heading（通常是页面主标题）
    if (headings.length > 0) {
      headings.sort((a, b) => a.level - b.level);
      return headings[0].name;
    }

    // 2. 从 tree 中查找 title 标签或特定模式
    if (tree) {
      const titlePatterns = [
        /(?:Job\s+Title|Position|Role)[:\s]+([^\n]{5,80})/i,
        /heading\s+"([^"]{5,80})"/,
      ];
      for (const p of titlePatterns) {
        const m = tree.match(p);
        if (m && !FieldParser.isNavText(m[1])) {
          return m[1].trim();
        }
      }
    }

    // 3. 从 link 中查找——在中间 ref 编号范围找合适长度的 link
    const allRefs = Object.entries(refs);
    const totalRefs = allRefs.length;
    const startIdx = Math.floor(totalRefs * 0.15);
    const endIdx = Math.floor(totalRefs * 0.80);

    let bestTitle = '';
    let bestScore = 0;

    for (const [ref, info] of allRefs) {
      const refNum = parseInt(ref.slice(1));
      if (info.role === 'link' && info.name && info.name.length > 15 && info.name.length < 120 && !FieldParser.isNavText(info.name)) {
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
   * 从浏览器页面标题中提取职位名
   * 处理 "Lead Analog Circuit Designer | Capgemini" 格式
   */
  static extractTitleFromPageTitle(pageTitle: string): string {
    if (!pageTitle || pageTitle.length < 5) return '';

    const separators = [' | ', ' - ', ' – ', ' — ', ' · '];
    for (const sep of separators) {
      if (pageTitle.includes(sep)) {
        const parts = pageTitle.split(sep);
        const candidate = parts[0].trim();
        if (candidate.length > 5 && candidate.length < 120 &&
            !candidate.toLowerCase().includes('career') &&
            !candidate.toLowerCase().includes('job search') &&
            !candidate.toLowerCase().includes('home')) {
          return candidate;
        }
      }
    }

    if (pageTitle.length > 5 && pageTitle.length < 120) {
      return pageTitle.trim();
    }

    return '';
  }

  /**
   * 从 description 文本中提取职位标题
   * 处理 "Senior Digital Design Engineer Job Description" 格式
   */
  static extractTitleFromDescription(description: string): string {
    if (!description) return '';

    const patterns = [
      /^(.{10,100}?)\s*Job\s+Description/i,
      /(?:Job\s+Title|Position|Role)\s*:\s*(.{5,100}?)(?:\n|$)/i,
      /Job\s+Description\s*:?\s*We\s+are\s+(?:seeking|looking\s+for)\s+(?:a\s+|an\s+)?(.{10,80}?)(?:\s+with\b|\s+who\b|\s+to\b|\.)/i,
    ];

    for (const p of patterns) {
      const m = description.match(p);
      if (m) {
        const candidate = (m[1] || m[2] || '').trim();
        if (candidate.length > 5 && candidate.length < 120) {
          return candidate;
        }
      }
    }

    return '';
  }

  /**
   * 从文本中提取地点（通用模式匹配）
   */
  static extractLocation(text: string): string {
    const patterns = [
      /([A-Z][a-z]+,\s*[A-Z]{2})/,
      /([A-Z][a-z]+,\s*[A-Z][a-z]+)/,
      /([A-Z][a-z]+\s+-?\s*[A-Z][a-z]+)/,
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
   * 从 accessibility tree 中提取地点信息
   * 查找 Location/地点 标签后面的文本
   */
  static extractLocationFromTree(tree: string): string {
    const cleanTree = tree.replace(/\[ref=e\d+\]/g, '').replace(/\[nth=\d+\]/g, '');

    const patterns = [
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
        if (
          loc.toLowerCase().includes('select') ||
          loc.toLowerCase().includes('textbox') ||
          loc.toLowerCase().includes('combobox') ||
          loc.toLowerCase().includes('button') ||
          loc.length < 3
        ) {
          continue;
        }
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
  static extractLocationFromDescription(description: string): string {
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
   * 综合提取地点（多策略瀑布）
   */
  static extractLocationAll(tree: string, description: string, title?: string): string {
    let location = FieldParser.extractLocationFromTree(tree);
    if (!location && title) {
      location = FieldParser.extractLocation(title);
    }
    if (!location) {
      location = FieldParser.extractLocationFromDescription(description);
    }
    return location;
  }

  /**
   * 从页面文本中提取结构化元数据
   * 包括发布日期、截止日期、职位类型、薪资
   */
  static extractJobMetadata(tree: string, description: string): JobMetadata {
    const text = tree + '\n' + description;

    // 提取发布日期
    let postDate = '';
    const postDatePatterns = [
      /Posted\s+(?:on\s*)?\s*(\d{1,2}\s+\w+\s+\d{4})/i,
      /Posted\s*on\s*(\d{1,2}\s*\w+\s*\d{4})/i,
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

    // 提取职位类型
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
   * 获取公司名称（从域名推断）
   */
  static getCompanyName(domain: string): string {
    // 先从映射表查找
    for (const [keyword, name] of Object.entries(FieldParser.companyMap)) {
      if (domain.includes(keyword)) return name;
    }

    // 从域名提取
    const parts = domain.split('.');
    if (parts.length >= 2) {
      return parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1);
    }

    return 'Unknown Company';
  }

  /**
   * 从快照中提取所有 refs
   */
  static extractRefs(snapshot: string): string[] {
    const refPattern = /\[ref=(e\d+)\]/g;
    const refs: string[] = [];
    let match;

    while ((match = refPattern.exec(snapshot)) !== null) {
      refs.push(match[1]);
    }

    return refs;
  }

  /**
   * 从快照中查找所有职位卡片的 refs
   * 适用于列表页
   */
  static findJobCardRefs(tree: string, refs: Record<string, any>): string[] {
    const jobRefs: string[] = [];
    const skipKeywords = ['Skip', 'Manage', 'View More', 'FAQ', 'Privacy', 'Terms', 'Cookie', 'Careers'];

    for (const [ref, info] of Object.entries(refs)) {
      if (info.role === 'link' && info.name && info.name.length > 30) {
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
}
