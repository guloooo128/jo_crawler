/**
 * Auto-generated parser for www.brattle.com
 * Generated at: 2026-02-10T03:47:52.530Z
 * Author: AI (GLM-4.7)
 * URL: https://www.brattle.com/careers/current-openings/
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class BrattleComParser extends BaseParser {
  metadata = {
    name: 'BrattleComParser',
    version: '1.0.0',
    domain: 'www.brattle.com',
    url: 'https://www.brattle.com/careers/current-openings/',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'Brattle 列表页解析器 - 使用 Greenhouse iframe',
  };

  canParse(_snapshot, url) {
    return url.includes('brattle.com/careers');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 50 } = options;

    console.log('📄 从 iframe 中提取职位链接...');

    // Brattle 使用 Greenhouse iframe 嵌入职位列表，需要使用 getJobLinksFromHTML 方法
    const allJobLinks = await browser.getJobLinksFromHTML();
    console.log('🔗 找到 ' + allJobLinks.length + ' 个职位链接');

    // 限制数量
    const linksToProcess = allJobLinks.slice(0, maxItems);
    console.log('✅ 共收集 ' + linksToProcess.length + ' 个职位链接');

    // === 逐个导航提取 ===
    for (const link of linksToProcess) {
      try {
        console.log('🚀 提取: ' + link.name);

        const titleFromList = link.name;

        await browser.navigate(link.url);
        await this.delay(2000);

        // 自己提取 description（最可靠）
        let rawText = '';
        try {
          rawText = await browser.getMainContentText();
        } catch (e) {
          rawText = await browser.getCleanPageText();
        }
        const description = this.cleanDescription(rawText, titleFromList);

        // 提取其他字段
        const location = this.extractLocation(rawText);
        const postDate = this.extractPostDate(rawText);
        const jobType = this.extractJobType(rawText);

        const jobData = this.createJobData({
          job_title: titleFromList,
          company_name: this.getCompanyName(),
          location: location,
          job_link: link.url,
          post_date: postDate,
          job_type: jobType,
          description: description,
          salary: '',
          source: this.getCompanyName(),
        });

        jobs.push(jobData);
      } catch (err) {
        console.error('❌ 失败: ' + err.message);
      }
    }

    return jobs;
  }

  // ====== 辅助方法 ======

  /**
   * 清理职位描述文本
   */
  cleanDescription(rawText, title) {
    if (!rawText) return '';

    let text = rawText;

    // 移除标题（如果 rawText 包含它）
    const titleVariants = [
      title,
      title.replace(/\s+/g, ' '),
      title.replace(/\s+/g, '').toLowerCase(),
    ];
    for (const variant of titleVariants) {
      if (variant && text.toLowerCase().startsWith(variant.toLowerCase())) {
        text = text.substring(variant.length).trim();
      }
    }

    // 移除常见的页眉/页脚噪音
    const noiseMarkers = [
      'Apply now',
      'Apply Now',
      'Share this job',
      'Similar jobs',
      'Related jobs',
      'Back to careers',
      'Application form',
      'Required fields',
    ];

    for (const marker of noiseMarkers) {
      const idx = text.toLowerCase().indexOf(marker.toLowerCase());
      if (idx !== -1) {
        text = text.substring(0, idx);
      }
    }

    // 清理空白字符
    text = text.replace(/\s+/g, ' ').trim();

    // 限制最大长度
    if (text.length > 10000) {
      text = text.substring(0, 10000);
    }

    return text;
  }

  /**
   * 从文本中提取地点信息
   */
  extractLocation(text) {
    if (!text) return '';

    // 常见地点模式
    const locationPatterns = [
      /(?:Location|Office|City)\s*[:：]\s*([^\n\r]{10,100}?)(?:\n|$)/i,
      /(?:地点|位置)\s*[:：]\s*([^\n\r]{10,100}?)(?:\n|$)/,
      /(?:Remote|远程|Hybrid|混合)\b/i,
      /(?:United States|USA?|U\.S\.A\.?)\b[^,\n\r]{0,50}/i,
      /(?:Canada|UK|United Kingdom|Germany|France|India|Singapore|China|Japan)\b[^,\n\r]{0,50}/,
    ];

    for (const pattern of locationPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      } else if (match && match[0]) {
        return match[0].trim();
      }
    }

    return '';
  }

  /**
   * 从文本中提取发布日期
   */
  extractPostDate(text) {
    if (!text) return '';

    // 常见日期模式
    const datePatterns = [
      /(?:Posted|Published|Date)\s*[:：]\s*(\d{1,2}[-/]\s*\d{1,2}[-/]\s*\d{2,4})/i,
      /(?:发布日期|发布时间|日期)\s*[:：]\s*(\d{1,2}[-/]\s*\d{1,2}[-/]\s*\d{2,4})/,
      /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i,
    ];

    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return '';
  }

  /**
   * 从文本中提取职位类型
   */
  extractJobType(text) {
    if (!text) return '';

    const typePatterns = [
      /\b(?:Full[- ]?time|Fulltime|全职)\b/i,
      /\b(?:Part[- ]?time|Parttime|兼职)\b/i,
      /\b(?:Contract|Contractor|合同工)\b/i,
      /\b(?:Intern|Internship|实习)\b/i,
      /\b(?:Remote|远程)\b/i,
      /\b(?:Hybrid|混合)\b/i,
    ];

    for (const pattern of typePatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0];
      }
    }

    return '';
  }
}
