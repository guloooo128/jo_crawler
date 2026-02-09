/**
 * Auto-generated parser for careers.cbre.com
 * Generated at: 2026-02-09T04:36:34.687Z
 * Author: AI (GLM-4.7)
 * URL: https://careers.cbre.com/en_US/careers/SearchJobs/?9577=%5B17134%5D&9577_format=10224&listFilterMode=1&jobSort=relevancy&jobRecordsPerPage=25&
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class CareersCbreComParser extends BaseParser {
  metadata = {
    name: 'CareersCbreCom',
    version: '1.0.0',
    domain: 'careers.cbre.com',
    url: 'https://careers.cbre.com/en_US/careers/SearchJobs/',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'careers.cbre.com list 页面职位解析器',
  };

  getCompanyName() {
    return 'CBRE';
  }

  canParse(_snapshot, url) {
    return url.includes('careers.cbre.com');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 10 } = options;

    console.log('🔍 使用 CareersCbreCom 解析器...');

    try {
      // 1. 处理 Cookie 弹窗
      await this.dismissCookies(browser);

      // 2. 获取列表页快照
      const { tree, refs } = await browser.getSnapshot({ interactive: true, maxDepth: 5 });

      // 3. 识别职位链接 Refs
      // 逻辑：排除导航栏、页脚、功能按钮，保留看起来像职位标题的链接
      // 排除词：Skip, About, Our, Join, Login, Search, Sort, Reset, Apply, Go to, Sign, Privacy, Terms, Sitemap, Cookies, Facebook, Linkedin, Twitter, More
      const excludeKeywords = [
        'skip', 'about', 'our', 'join', 'login', 'search', 'sort', 'reset', 'apply', 
        'go to', 'sign', 'privacy', 'terms', 'sitemap', 'cookies', 'facebook', 'linkedin', 'twitter', 'more', 'grow your career'
      ];
      
      const jobRefEntries = Object.entries(refs).filter(([key, ref]) => {
        if (!ref.name) return false;
        const nameLower = ref.name.toLowerCase();
        
        // 必须是链接
        if (ref.role !== 'link') return false;

        // 排除功能链接
        if (excludeKeywords.some(kw => nameLower.includes(kw))) return false;

        // 过滤掉过短或过长的非职位文本
        if (ref.name.length < 5 || ref.name.length > 100) return false;

        // 必须包含常见职位关键词或括号内容（如 Multiple Seniority, Hong Kong）
        // 或者包含常见职位单词
        const jobKeywords = ['manager', 'coordinator', 'services', 'consulting', 'senior', 'officer', 'engineer', 'designer', 'trainee', 'internship', 'lead', 'assistant', 'developer', 'analyst', 'director'];
        const hasJobKeyword = jobKeywords.some(kw => nameLower.includes(kw));
        const hasParentheses = ref.name.includes('(');

        return hasJobKeyword || hasParentheses;
      });

      console.log(`🔎 找到 ${jobRefEntries.length} 个职位候选链接`);

      // 4. 收集所有职位 URL
      const jobLinks = await this.collectJobLinks(browser, jobRefEntries);
      console.log(`✅ 成功收集 ${jobLinks.length} 个职位 URL`);

      // 保存当前列表页 URL，用于后续可能的分页或重置
      const listUrl = await browser.getCurrentUrl();

      // 5. 遍历职位链接进行详情提取
      for (let i = 0; i < Math.min(jobLinks.length, maxItems); i++) {
        const link = jobLinks[i];
        console.log(`\n📄 正在处理 (${i + 1}/${Math.min(jobLinks.length, maxItems)}): ${link.name}`);

        try {
          // 导航到详情页
          await browser.navigate(link.url);
          await this.delay(2000); // 等待页面加载

          // 再次尝试处理 Cookie（有些页面会重新弹出）
          await this.dismissCookies(browser);

          // 提取详情页字段
          const detail = await this.extractDetailFields(browser);

          // 获取原始文本用于自定义提取
          let rawText = '';
          try {
            rawText = await browser.getMainContentText();
          } catch (e) {
            console.warn('获取 MainContentText 失败，尝试 CleanPageText');
            rawText = await browser.getCleanPageText();
          }

          // 清理 Description
          const description = this.cleanDescription(rawText, link.name);

          // 从原始文本提取日期
          const dates = this.extractDatesFromRawText(rawText);

          // 从列表页 Link Name 解析部分字段
          const listInfo = this.parseListName(link.name);

          // 构建数据
          const jobData = this.createJobData({
            job_title: link.name, // 列表页标题通常最准确
            company_name: this.getCompanyName(),
            location: this.cleanLocation(detail.location) || listInfo.location,
            job_link: link.url,
            post_date: detail.post_date || dates.post_date,
            dead_line: detail.dead_line || dates.dead_line,
            job_type: listInfo.type || detail.job_type,
            description: description,
            salary: this.cleanSalary(detail.salary),
            source: this.getCompanyName(),
          });

          jobs.push(jobData);
        } catch (err) {
          console.error(`❌ 提取职位失败 [${link.name}]:`, err.message);
        }
      }

      // 如果需要分页，可以在这里添加逻辑导航回 listUrl 并点击下一页
      // await browser.navigate(listUrl);

    } catch (error) {
      console.error('❌ 解析过程严重错误:', error.message);
    }

    return jobs;
  }

  // --- 辅助方法 ---

  /**
   * 尝试关闭 Cookie 弹窗
   */
  async dismissCookies(browser) {
    try {
      const { refs } = await browser.getSnapshot({ interactive: true, maxDepth: 3 });
      // 查找 "Reject All" 或 "Accept All Cookies" 按钮
      const rejectBtn = Object.values(refs).find(r => r.name && r.name.toLowerCase().includes('reject all'));
      const acceptBtn = Object.values(refs).find(r => r.name && r.name.toLowerCase().includes('accept all cookies'));
      
      if (rejectBtn) {
        await browser.click(rejectBtn.ref);
        await this.delay(1000);
        console.log('🍪 已关闭 Cookie 弹窗 (Reject All)');
      } else if (acceptBtn) {
        await browser.click(acceptBtn.ref);
        await this.delay(1000);
        console.log('🍪 已关闭 Cookie 弹窗 (Accept All)');
      }
    } catch (e) {
      // 忽略关闭 Cookie 时的错误
    }
  }

  /**
   * 从列表页的 Link Name 解析结构化信息
   * 示例: "Interior Designer - Workplace Consulting (Hong Kong)"
   * 示例: "Valuation and Advisory Services (Multiple Seniority)"
   */
  parseListName(name) {
    let location = '';
    let type = '';

    // 提取括号内的内容作为 Location 或 Type
    const parenMatch = name.match(/\(([^)]+)\)/);
    if (parenMatch) {
      const content = parenMatch[1];
      // 如果包含地点特征（如 Hong Kong, US, UK），则为 Location
      if (content.includes('Hong Kong') || content.includes('US') || content.includes('UK') || content.includes('Canada')) {
        location = content;
      } else if (content.includes('Seniority') || content.includes('Time')) {
        type = content;
      } else {
        // 默认归为 Location
        location = content;
      }
    }

    // 尝试从名字中提取 Type (如 Full-time, Part-time, Contract)
    const typeMatch = name.match(/\b(Full-time|Part-time|Contract|Permanent|Internship)\b/i);
    if (typeMatch) {
      type = typeMatch[1];
    }

    return { location, type };
  }

  /**
   * 清理 Description
   * CBRE 的详情页文本通常是连续的，需要去除头部和尾部噪音
   */
  cleanDescription(rawText, jobTitle) {
    if (!rawText) return '';

    let text = rawText;

    // 1. 去除头部噪音
    // 移除重复的标题
    if (jobTitle && text.includes(jobTitle)) {
      const titleIndex = text.indexOf(jobTitle);
      // 如果标题出现得很早，截取标题之后的内容
      if (titleIndex < 200) {
        text = text.substring(titleIndex + jobTitle.length);
      }
    }
    
    // 移除常见的头部噪音标记
    const noiseStartPatterns = [
      'From selling properties',
      'Careers at CBRE',
      'Job Description',
      'About the Job',
      'Overview'
    ];
    
    for (const pattern of noiseStartPatterns) {
      const index = text.indexOf(pattern);
      if (index !== -1 && index < 500) {
        text = text.substring(index);
        break; // 找到第一个合理的开头就停止
      }
    }

    // 2. 去除尾部噪音
    const noiseEndPatterns = [
      'Similar Jobs',
      'Discover CBRE',
      'Why CBRE',
      'Discover more about CBRE',
      'Share this job',
      'Apply now'
    ];

    let minEndIndex = text.length;
    for (const pattern of noiseEndPatterns) {
      const index = text.indexOf(pattern);
      if (index !== -1 && index < minEndIndex) {
        minEndIndex = index;
      }
    }
    
    text = text.substring(0, minEndIndex);

    // 3. 最终清理：去除多余空白，但保留段落结构
    return this.cleanText(text).trim();
  }

  /**
   * 清理 Location
   * 处理可能残留的标签前缀，如 "sToronto, ON"
   */
  cleanLocation(rawLocation) {
    if (!rawLocation) return '';
    
    let loc = rawLocation.trim();
    
    // 去除开头的非字母字符（如果是小写字母开头，可能是截断残留）
    // 例如 "sToronto" -> "Toronto"
    if (/^[a-z]{1,3}[A-Z]/.test(loc)) {
      loc = loc.replace(/^[a-z]{1,3}/, '');
    }

    // 去除常见的拼接噪音
    const noisePatterns = ['time', 'type', 'posted', 'on', 'job requisition'];
    for (const pattern of noisePatterns) {
      const index = loc.toLowerCase().indexOf(pattern);
      if (index !== -1) {
        loc = loc.substring(0, index);
      }
    }

    return this.cleanText(loc);
  }

  /**
   * 清理 Salary
   * 验证是否包含真正的薪资信息
   */
  cleanSalary(rawSalary) {
    if (!rawSalary) return '';
    
    const salary = rawSalary.trim();
    
    // 检查是否包含货币符号或数字范围
    const hasMoney = /\$|€|£|¥/.test(salary);
    const hasNumberRange = /\d+,\d+\s*-\s*\d+,\d+/.test(salary);
    const hasHourlyRate = /\$\d+\s*\/\s*hour/i.test(salary);
    
    if (hasMoney || hasNumberRange || hasHourlyRate) {
      return this.cleanText(salary);
    }
    
    return '';
  }

  /**
   * 从原始文本中提取日期
   */
  extractDatesFromRawText(rawText) {
    const dates = {
      post_date: '',
      dead_line: ''
    };

    if (!rawText) return dates;

    // 提取 Posted Date (例如 "Posted 2 Days Ago")
    const postMatch = rawText.match(/posted\s+(\d+\s+days?\s+ago)/i);
    if (postMatch) {
      dates.post_date = postMatch[1];
    }

    // 提取 Deadline (例如 "End Date: Month DD, YYYY")
    const deadMatch = rawText.match(/end\s+date:\s*([a-zA-Z]+\s+\d+,\s*\d{4})/i);
    if (deadMatch) {
      dates.dead_line = deadMatch[1];
    }

    return dates;
  }

  getDefaults() {
    return {
      maxItems: 10,
      followPagination: false,
      includeDetails: true,
    };
  }
}