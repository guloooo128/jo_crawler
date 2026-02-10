/**
 * Auto-generated parser for www.brattle.com
 * Generated at: 2026-02-10T04:26:15.135Z
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
    description: 'Brattle.com 列表页解析器 (Greenhouse iframe)',
  };

  canParse(_snapshot, url) {
    return url.includes('brattle.com/careers');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 50, maxPages = 5 } = options;

    let allJobLinks = [];
    let currentPage = 1;

    // === 阶段一：翻页收集所有职位URL ===
    // Brattle 使用 Greenhouse iframe，直接从 HTML 提取链接
    while (currentPage <= maxPages && allJobLinks.length < maxItems) {
      console.log('📄 第 ' + currentPage + ' 页...');

      // 特殊处理：使用 getJobLinksFromHTML 提取 iframe 中的职位
      const pageLinks = await browser.getJobLinksFromHTML();
      console.log('🔗 找到 ' + pageLinks.length + ' 个职位链接');

      // 去重合并
      const existingUrls = new Set(allJobLinks.map(l => l.url.url || l.url)); // 处理返回格式可能不同的情况
      const newLinks = pageLinks.filter(l => {
        const url = l.url.url || l.url;
        return !existingUrls.has(url);
      });
      allJobLinks.push(...newLinks);

      if (newLinks.length == 0) break;
      if (allJobLinks.length >= maxItems) break;

      // === 翻页逻辑 ===
      // 尝试 URL 参数翻页
      const currentUrl = await browser.getCurrentUrl();
      const nextPageUrl = currentUrl.includes('?')
        ? currentUrl + '&page=' + (currentPage + 1)
        : currentUrl + '?page=' + (currentPage + 1);
      
      console.log('➡️ 尝试翻页至: ' + nextPageUrl);
      await browser.navigate(nextPageUrl);
      await this.delay(2000);
      
      // 简单检测是否翻页成功（通过 URL 变化或内容变化），这里简化处理直接增加页码
      currentPage++;
    }

    console.log('✅ 共收集 ' + allJobLinks.length + ' 个职位链接');

    // === 阶段二：逐个导航提取 ===
    for (const link of allJobLinks.slice(0, maxItems)) {
      try {
        // 兼容不同的返回格式
        const jobUrl = link.url.url || link.url;
        const jobName = link.url.name || link.name || 'Unknown Title';

        console.log('🚀 提取: ' + jobName);

        await browser.navigate(jobUrl);
        await this.delay(2000);

        // 自己提取 description（最可靠）
        let rawText = '';
        try {
          rawText = await browser.getMainContentText();
        } catch (e) {
          rawText = await browser.getCleanPageText();
        }
        const description = this.cleanDescription(rawText, jobName);

        // 提取其他字段
        const location = this.extractLocation(rawText);
        const postDate = this.extractPostDate(rawText);
        const jobType = this.extractJobType(rawText);

        const jobData = this.createJobData({
          job_title: jobName,
          company_name: this.getCompanyName(),
          location: location,
          job_link: jobUrl,
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

  // ===== 辅助方法 =====

  cleanDescription(rawText, title) {
    if (!rawText) return '';

    let text = rawText;

    // 移除标题部分（通常在开头）
    if (title) {
      const titleIdx = text.indexOf(title);
      if (titleIdx != -1) {
        text = text.substring(titleIdx + title.length);
      }
    }

    // 找正文起点
    const startMarkers = [
      'ABOUT THE BRATTLE GROUP',
      'ABOUT THIS ROLE',
      'Job Description',
      'Overview',
      'Responsibilities',
      'What You\'ll Do',
      'Your Role',
      'Qualifications'
    ];

    let startIdx = -1;
    for (const marker of startMarkers) {
      const idx = text.indexOf(marker);
      if (idx != -1 && (startIdx == -1 || idx < startIdx)) {
        startIdx = idx;
      }
    }

    if (startIdx > 0) {
      text = text.substring(startIdx);
    }

    // 找终点
    const endMarkers = [
      'Similar Jobs',
      'Related Jobs',
      'Share this job',
      'Privacy Policy',
      'Cookie Settings',
      'Follow us',
      'Apply now',
      'Back to jobs'
    ];

    let endIdx = text.length;
    for (const marker of endMarkers) {
      const idx = text.toLowerCase().indexOf(marker.toLowerCase());
      if (idx != -1 && idx < endIdx) {
        endIdx = idx;
      }
    }

    text = text.substring(0, endIdx);

    return this.cleanText(text);
  }

  extractLocation(text) {
    // Greenhouse 格式通常在标题附近，例如 "Boston, Massachusetts, United States"
    // 尝试匹配 "City, State, Country" 或 "City, State"
    const patterns = [
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/, // City, State Country
      /Location:\s*([A-Za-z][A-Za-z0-9 ,]+)/i,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1].length > 3 && m[1].length < 60) {
        return m[1].trim();
      }
    }

    return '';
  }

  extractPostDate(text) {
    const patterns = [
      /Posted:\s*(\d{1,2}\s+\w+\s+\d{4})/i,
      /Date Posted:\s*(\d{4}-\d{2}-\d{2})/,
      /Posted\s+(\d+\s+days?\s+ago)/i,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }

    return '';
  }

  extractJobType(text) {
    const patterns = [
      /Job Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i,
      /Employment:\s*(Full-time|Part-time|Contract)/i,
      /(Full-time|Part-time)\s*Position/i,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }

    return '';
  }

  getDefaults() {
    return { maxItems: 50, maxPages: 5 };
  }
}