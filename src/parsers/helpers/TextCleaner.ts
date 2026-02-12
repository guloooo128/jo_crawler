/**
 * TextCleaner — 文本清洗模块
 *
 * 从 BaseParser 中提取的文本清洗相关功能。
 * 负责清理页面原始文本、提取 JD 核心内容、移除噪声。
 */

/**
 * 描述清洗配置
 */
export interface CleanDescriptionOptions {
  /** JD 正文起始标记词 */
  startMarkers?: string[];
  /** JD 正文终止标记词 */
  endMarkers?: string[];
  /** 最大长度 */
  maxLength?: number;
}

/** 默认 JD 起始标记 */
const DEFAULT_START_MARKERS = [
  'Job Description',
  'Description',
  'About this role',
  'About the Role',
  'About the Job',
  'What you\'ll do',
  'What You\u2019ll Do',
  'Your responsibilities',
  'Role Summary',
  'Role Overview',
  'Role Description',
  'Position Summary',
  'Position Overview',
  'Position Description',
  'Key Responsibilities',
  'Relevant Tasks',
  'We are seeking',
  'We are looking for',
  'Your mission',
  'Overview',
  'Responsibilities',
];

/** 默认 JD 终止标记 */
const DEFAULT_END_MARKERS = [
  'Similar Jobs',
  'Related Jobs',
  'Share this job',
  'Share This Job',
  'Privacy Policy',
  'Cookie Settings',
  'Cookie settings',
  'Follow us',
  'Apply now',
  'Apply Now',
  'Back to search',
  'Back to results',
  'Learn more about',
  'Why join',
  'Our brands',
  'Insights Industries Services',
  'Search Jobs',
  'Footer',
];

/** 尾部元数据移除正则 */
const TRAILING_METADATA_PATTERNS = [
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

/** 导航/无关内容移除模式 */
const SKIP_PATTERNS = [
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

export class TextCleaner {
  /**
   * 清理文本（去除多余空白）
   */
  static cleanText(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n');
  }

  /**
   * 清理职位描述文本
   *
   * 从原始页面文本中提取 JD 核心内容：
   * 1. 移除尾部元数据标签行
   * 2. 定位 JD 正文起始点
   * 3. 截断尾部无关内容
   *
   * @param rawText 原始文本（通常来自 getMainContentText()）
   * @param options 清洗配置
   */
  static cleanDescription(rawText: string, options?: CleanDescriptionOptions): string {
    if (!rawText) return '';

    let cleaned = rawText;
    const startMarkers = options?.startMarkers ?? DEFAULT_START_MARKERS;
    const endMarkers = options?.endMarkers ?? DEFAULT_END_MARKERS;
    const maxLength = options?.maxLength ?? 8000;

    // 1. 移除尾部元数据行
    for (const pattern of TRAILING_METADATA_PATTERNS) {
      cleaned = cleaned.replace(pattern, '');
    }

    // 2. 定位 JD 正文起始点
    let jdStart = -1;
    for (const marker of startMarkers) {
      const idx = cleaned.indexOf(marker);
      if (idx !== -1 && (jdStart === -1 || idx < jdStart)) {
        jdStart = idx;
      }
    }
    // 也用 regex 模式匹配（处理大小写/空格差异）
    const jdStartRegexPatterns = [
      /(?:Job\s+)?Description\s*:?/i,
      /About\s+this\s+role/i,
      /What\s+you['']ll\s+do/i,
      /Your\s+responsibilities/i,
      /Role\s+(?:Summary|Overview|Description)/i,
      /Position\s+(?:Summary|Overview|Description)/i,
      /Key\s+Responsibilities/i,
      /We\s+are\s+(?:seeking|looking\s+for)/i,
    ];
    for (const pattern of jdStartRegexPatterns) {
      const match = cleaned.search(pattern);
      if (match !== -1 && (jdStart === -1 || match < jdStart)) {
        jdStart = match;
      }
    }

    if (jdStart > 0 && jdStart < cleaned.length * 0.5) {
      cleaned = cleaned.substring(jdStart);
    }

    // 3. 截断尾部无关内容
    let endIdx = cleaned.length;
    for (const marker of endMarkers) {
      const idx = cleaned.toLowerCase().indexOf(marker.toLowerCase());
      if (idx !== -1 && idx > 200 && idx < endIdx) {
        endIdx = idx;
      }
    }
    cleaned = cleaned.substring(0, endIdx);

    // 4. 最终清理
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength) + '...';
    }

    return cleaned;
  }

  /**
   * 清理页面原始文本，彻底移除 JS/CSS/HTML 垃圾
   * 适用于 getPageText() 返回的原始文本
   */
  static cleanPageText(pageText: string): string {
    let cleaned = pageText;

    // === 第一步：移除 JS/CSS 代码块 ===
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
    cleaned = cleaned.replace(/\{[^}]{20,}\}/g, '');
    cleaned = cleaned.replace(/\.[a-z][a-z-]*\s*\{[^}]*\}/gi, '');
    cleaned = cleaned.replace(/#[a-z][a-z-]*\s*\{[^}]*\}/gi, '');
    cleaned = cleaned.replace(/@media\s+[^{]*\{[\s\S]*?\}\s*\}/gi, '');
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
    for (const pattern of SKIP_PATTERNS) {
      cleaned = cleaned.replace(pattern, '');
    }

    // === 第三步：定位 JD 核心内容 ===
    const jdStartPatterns = [
      /(?:Job\s+)?Description\s*:/i,
      /(?:Job\s+)?Description(?=\s|[A-Z])/i,
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
      if (match !== -1 && match > 200) {
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
   * 从 tree 中提取 JD 段落
   */
  static extractJDSections(tree: string): string[] {
    const sections: string[] = [];
    const paragraphs = tree.split('\n\n');

    for (const para of paragraphs) {
      if (para.length < 50) continue;
      if (TextCleaner.shouldSkipParagraph(para)) continue;
      sections.push(para.trim());
    }

    return sections;
  }

  /**
   * 清理 tree 用于作为描述（fallback）
   */
  static cleanTreeForDescription(tree: string): string {
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

  /**
   * 判断是否应该跳过某个段落
   */
  private static shouldSkipParagraph(para: string): boolean {
    const skipPatterns = [
      /^-.*button\s+"/,
      /^-.*link\s+"/,
      /^\[ref=/,
      /^(Skip|Manage|FAQ|Privacy|Terms|Cookie|Apply)/,
    ];
    return skipPatterns.some(pattern => pattern.test(para));
  }
}
