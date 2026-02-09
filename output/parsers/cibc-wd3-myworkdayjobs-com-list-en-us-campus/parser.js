/**
 * Auto-generated parser for cibc.wd3.myworkdayjobs.com
 * Generated at: 2026-02-09T15:01:31.862Z
 * Author: AI (GLM-4.7)
 * URL: https://cibc.wd3.myworkdayjobs.com/en-US/campus
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class CibcWd3MyworkdayjobsComParser extends BaseParser {
  metadata = {
    name: 'CibcWd3MyworkdayjobsCom',
    version: '1.0.0',
    domain: 'cibc.wd3.myworkdayjobs.com',
    url: 'https://cibc.wd3.myworkdayjobs.com/en-US/campus',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'cibc.wd3.myworkdayjobs.com list 页面职位解析器',
  };

  // 重写公司名称
  getCompanyName() {
    return 'CIBC';
  }

  canParse(_snapshot, url) {
    return url.includes('cibc.wd3.myworkdayjobs.com');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 10, maxPages = 5 } = options;

    console.log('🔍 使用 CibcWd3MyworkdayjobsCom 解析器...');

    try {
      const listUrl = await browser.getCurrentUrl();
      let allJobLinks = [];
      let currentPage = 1;

      // ===== 阶段一：翻页收集所有职位 URL =====
      while (currentPage <= maxPages && allJobLinks.length < maxItems) {
        console.log(`📄 第 ${currentPage} 页...`);
        
        // 获取当前页快照
        const { tree, refs } = await browser.getSnapshot({ interactive: true, maxDepth: 5 });
        
        // 过滤出职位链接 refs
        // 排除页脚、导航、分页按钮，保留包含职位信息的链接
        // 职位链接通常包含地点、年份、Analyst/Co-op 等关键词
        const jobRefs = Object.entries(refs).filter(([key, ref]) => {
          if (ref.role !== 'link') return false;
          if (!ref.name) return false;
          
          const name = ref.name;
          // 排除导航和无关链接
          if (/skip to|search for|facebook|youtube|x|google plus|glassdoor|linkedin|cibc\.com|mailbox/i.test(name)) {
            return false;
          }
          // 职位链接特征：包含年份或职位关键词
          return /202[5-9]|analyst|co-?op|intern|summer|winter|director|manager|associate|vice president/i.test(name);
        });
        
        // 收集本页的职位 URL
        const pageLinks = await this.collectJobLinks(browser, jobRefs);
        console.log(`🔗 第 ${currentPage} 页找到 ${pageLinks.length} 个职位链接`);
        
        // 合并（去重）
        const existingUrls = new Set(allJobLinks.map(l => l.url));
        const newLinks = pageLinks.filter(l => !existingUrls.has(l.url));
        allJobLinks.push(...newLinks);
        
        // 如果本页没有新链接，说明没有更多内容了
        if (newLinks.length === 0) {
          console.log('📭 没有新职位，停止翻页');
          break;
        }
        
        // 如果已够数量，停止翻页
        if (allJobLinks.length >= maxItems) break;
        
        // ===== 翻页逻辑 =====
        // 根据快照，存在 "next" 按钮 (@e36)
        const nextBtn = Object.entries(refs).find(([k, r]) =>
          (r.role === 'link' || r.role === 'button') && 
          r.name && /next|下一页|›|»|arrow.?right/i.test(r.name)
        );

        if (nextBtn) {
          console.log('👉 点击 Next 按钮翻页...');
          await browser.click('@' + nextBtn[0]);
          await this.delay(2500); // 等待页面加载
          currentPage++;
          continue;
        } else {
          console.log('⚠️ 未找到 Next 按钮，停止翻页');
          break;
        }
      }

      console.log(`✅ 共收集到 ${allJobLinks.length} 个职位链接`);

      // ===== 阶段二：逐个导航到详情页提取数据 =====
      for (const link of allJobLinks.slice(0, maxItems)) {
        if (jobs.length >= maxItems) break;
        try {
          console.log(`🚀 正在提取: ${link.name}`);
          
          // 解析 link.name 中能得到的字段
          const titleFromList = link.name;
          const locationFromList = this.extractLocationFromTitle(link.name);
          const typeFromList = this.extractTypeFromTitle(link.name);
          
          // 直接导航到详情页
          await browser.navigate(link.url);
          await this.delay(2000);
          
          // 使用内置方法提取详情页字段
          const detail = await this.extractDetailFields(browser);
          
          // 【重要】description 始终自己从原始文本提取
          let rawText = '';
          try { rawText = await browser.getMainContentText(); } catch(e) {}
          if (!rawText || rawText.length < 200) {
            try { rawText = await browser.getCleanPageText(); } catch(e) {}
          }
          const description = this.cleanDescription(rawText, titleFromList);
          
          // 从原始文本中提取日期（extractDetailFields 可能提取不到）
          const dates = this.extractDatesFromRawText(rawText);
          
          // 清理 location (去除 "locations" 残留)
          const cleanLoc = this.cleanLocation(detail.location);
          
          const jobData = this.createJobData({
            job_title: titleFromList || detail.job_title,
            company_name: this.getCompanyName(),
            location: cleanLoc || locationFromList,
            job_link: link.url,
            post_date: detail.post_date || dates.post_date,
            dead_line: detail.dead_line || dates.dead_line,
            job_type: typeFromList || detail.job_type,
            description,
            salary: this.cleanSalary(detail.salary),
            source: this.getCompanyName(),
          });
          jobs.push(jobData);
        } catch (err) {
          console.error('❌ 提取失败:', err.message);
        }
      }
    } catch (error) {
      console.error('❌ 解析失败:', error.message);
    }

    return jobs;
  }

  /**
   * 从职位标题中提取地点 (例如: "Analyst (Vancouver)" -> "Vancouver")
   */
  extractLocationFromTitle(title) {
    if (!title) return '';
    // 匹配括号内的地点
    const match = title.match(/\(([^)]+)\)$/);
    if (match) return match[1];
    return '';
  }

  /**
   * 从职位标题中提取职位类型
   */
  extractTypeFromTitle(title) {
    if (!title) return '';
    const lower = title.toLowerCase();
    if (lower.includes('full time')) return 'Full-time';
    if (lower.includes('part time')) return 'Part-time';
    if (lower.includes('co-op') || lower.includes('coop')) return 'Co-op';
    if (lower.includes('intern')) return 'Internship';
    if (lower.includes('contract')) return 'Contract';
    if (lower.includes('permanent')) return 'Permanent';
    return '';
  }

  /**
   * 清理 Description
   * 原始文本是连续字符串，需要定位正文起止位置
   */
  cleanDescription(rawText, jobTitle) {
    if (!rawText) return '';
    
    let text = rawText;
    let startIndex = 0;
    let endIndex = text.length;

    // 1. 去除头部噪音
    // 找到元数据段的结束标记，例如 "job requisition id\d+"
    const metaEndMatch = text.match(/job requisition id\d+/i);
    if (metaEndMatch && metaEndMatch.index) {
      startIndex = metaEndMatch.index + metaEndMatch[0].length;
    } else {
      // 备用方案：移除标题和 "Apply" 等常见头部噪音
      // 找到 "What you'll be doing" 或 "Description" 等正文开始标记
      const bodyStartMatch = text.match(/(what you'll be doing|description|about the job|job summary)/i);
      if (bodyStartMatch && bodyStartMatch.index) {
        startIndex = bodyStartMatch.index;
      } else if (jobTitle) {
        // 如果找不到元数据结束标记，尝试跳过标题
        const titleIndex = text.indexOf(jobTitle);
        if (titleIndex > -1) {
          startIndex = titleIndex + jobTitle.length;
        }
      }
    }

    // 2. 去除尾部噪音
    // 常见页脚标记
    const footerKeywords = ['similar jobs', 'share this job', 'apply now', 'return to search', 'required education'];
    for (const keyword of footerKeywords) {
      const idx = text.toLowerCase().indexOf(keyword, startIndex);
      if (idx > -1) {
        endIndex = idx;
        break;
      }
    }

    let description = text.substring(startIndex, endIndex).trim();
    
    // 3. 清理多余的空白字符
    description = description.replace(/\s+/g, ' ').trim();
    
    return description;
  }

  /**
   * 清理 Location
   * 去除 "locations" 残留前缀和尾部拼接的 "time type" 等
   */
  cleanLocation(rawLocation) {
    if (!rawLocation) return '';
    let loc = rawLocation.trim();
    
    // 去除开头的残留字母 (例如 "sToronto, ON" -> "Toronto, ON")
    // 假设地点以大写字母开头，如果开头是小写字母或 's'，则截断
    if (/^[a-z]{1,3}[A-Z]/.test(loc)) {
      loc = loc.replace(/^[a-z]{1,3}/, '');
    }
    
    // 去除 "locations" 前缀
    if (loc.toLowerCase().startsWith('locations')) {
      loc = loc.substring(9).trim();
    }
    
    // 截断尾部可能拼接的元数据 (例如 "Toronto, ONtime typeFull time")
    const splitIndex = loc.search(/time type|posted on|job requisition/i);
    if (splitIndex > -1) {
      loc = loc.substring(0, splitIndex).trim();
    }
    
    return loc;
  }

  /**
   * 清理 Salary
   * 验证是否包含真正的薪资信息
   */
  cleanSalary(rawSalary) {
    if (!rawSalary) return '';
    const salary = rawSalary.trim();
    
    // 检查是否包含货币符号或数字范围
    if (/^\$|£|€/.test(salary) || /\d+,\d+|\d+k-\d+k/i.test(salary)) {
      return salary;
    }
    
    // 如果不包含明显的薪资特征，可能是误匹配，返回空
    return '';
  }

  /**
   * 从原始文本中提取日期
   */
  extractDatesFromRawText(rawText) {
    const result = { post_date: '', dead_line: '' };
    if (!rawText) return result;

    // 提取 post_date (例如 "Posted Today", "Posted 2 Days Ago")
    const postMatch = rawText.match(/posted\s+(today|\d+\s+days?\s+ago| \d{1,2}\/\d{1,2}\/\d{4})/i);
    if (postMatch) {
      result.post_date = postMatch[1];
    }

    // 提取 dead_line (例如 "End Date: March 9, 2026")
    const deadMatch = rawText.match(/end date:\s*([^(\n]+)/i);
    if (deadMatch) {
      result.dead_line = deadMatch[1].trim();
    }

    return result;
  }

  getDefaults() {
    return {
      maxItems: 10,
      maxPages: 5,
      followPagination: true,
      includeDetails: true,
    };
  }
}