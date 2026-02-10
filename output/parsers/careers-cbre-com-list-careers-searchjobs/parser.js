/**
 * Auto-generated parser for careers.cbre.com
 * Generated at: 2026-02-10T03:43:55.894Z
 * Author: AI (GLM-4.7)
 * URL: https://careers.cbre.com/en_US/careers/SearchJobs/?9577=%5B17134%5D&9577_format=10224&listFilterMode=1&jobSort=relevancy&jobRecordsPerPage=25&
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class CareersCbreComParser extends BaseParser {
  metadata = {
    name: 'CareersCbreComParser',
    version: '1.0.0',
    domain: 'careers.cbre.com',
    url: 'https://careers.cbre.com/en_US/careers/SearchJobs/',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    'description': 'CBRE Careers 列表页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('careers.cbre.com');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 50, maxPages = 5 } = options;

    // 尝试关闭 Cookie 弹窗
    try {
      const { refs: cookieRefs } = await browser.getSnapshot({ interactive: true, maxDepth: 3 });
      const acceptBtn = Object.entries(cookieRefs).find(([k, r]) =>
        (r.role == 'button' || r.role == 'link') && 
        /accept|agree|allow|close|dismiss/i.test(r.name || '')
      );
      if (acceptBtn) {
        await browser.click('@' + acceptBtn[0]);
        await this.delay(1000);
      }
    } catch (e) {
      // 忽略关闭弹窗时的错误
    }

    const listUrl = await browser.getCurrentUrl();
    let allJobLinks = [];
    let currentPage = 1;

    // === 阶段一：翻页收集所有职位URL ===
    while (currentPage <= maxPages && allJobLinks.length < maxItems) {
      console.log('📄 第 ' + currentPage + ' 页...');

      const { tree, refs } = await browser.getSnapshot({ interactive: true, maxDepth: 5 });

      // 根据快照分析编写过滤逻辑
      const skipKeywords = ['about', 'contact', 'home', 'privacy', 'login', 'register', 'search', 'filter', 'save', 'share'];
      const jobRefs = Object.entries(refs).filter(([key, ref]) => {
        if (ref.role != 'link' || !ref.name) return false;
        // 职位标题通常长度适中，包含常见职位关键词
        if (ref.name.length < 10 || ref.name.length > 150) return false;
        const nameLower = ref.name.toLowerCase();
        if (skipKeywords.some(kw => nameLower.includes(kw))) return false;
        // 必须包含有效的 URL
        if (!ref.url || !ref.url.includes('http')) return false;
        return true;
      });

      const pageLinks = await this.collectJobLinks(browser, jobRefs);
      console.log('🔗 找到 ' + pageLinks.length + ' 个职位链接');

      // 去重合并
      const existingUrls = new Set(allJobLinks.map(l => l.url));
      const newLinks = pageLinks.filter(l => !existingUrls.has(l.url));
      allJobLinks.push(...newLinks);

      if (newLinks.length == 0) break;
      if (allJobLinks.length >= maxItems) break;

      // === 翻页逻辑 ===
      const loadMoreBtn = Object.entries(refs).find(([k, r]) =>
        r.role == 'button' && /load more|show more|更多/i.test(r.name || '')
      );
      const nextBtn = Object.entries(refs).find(([k, r]) =>
        (r.role == 'link' || r.role == 'button') && /next|下一页|›|»/i.test(r.name || '')
      );

      if (loadMoreBtn) {
        await browser.click('@' + loadMoreBtn[0]);
        await this.delay(2000);
        currentPage++;
        continue;
      } else if (nextBtn) {
        await browser.click('@' + nextBtn[0]);
        await this.delay(2000);
        currentPage++;
        continue;
      } else {
        // 尝试URL参数翻页
        let nextPageUrl = '';
        if (listUrl.includes('page=')) {
          nextPageUrl = listUrl.replace(/page=\d+/, 'page=' + (currentPage + 1));
        } else if (listUrl.includes('?')) {
          nextPageUrl = listUrl + '&page=' + (currentPage + 1);
        } else {
          nextPageUrl = listUrl + '?page=' + (currentPage + 1);
        }
        
        await browser.navigate(nextPageUrl);
        await this.delay(2000);
        currentPage++;
        continue;
      }

      break;
    }

    console.log('✅ 共收集 ' + allJobLinks.length + ' 个职位链接');

    // === 阶段二：逐个导航提取 ===
    for (const link of allJobLinks.slice(0, maxItems)) {
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

  // ===== 辅助方法 =====

  cleanDescription(rawText) {
    if (!rawText) return '';

    let text = rawText;

    // 找正文起点
    const startMarkers = [
      'Job Description', 'Overview', 'About This Role',
      'Responsibilities', 'What You\'ll Do', 'Your Role',
      'Job Summary', 'Description'
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
      'Similar Jobs', 'Related Jobs', 'Share this job',
      'Privacy Policy', 'Cookie Settings', 'Follow us',
      'Apply Now', 'Back to Search'
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
    const patterns = [
      /Location:\s*([A-Za-z][A-Za-z0-9 ,]+)/i,
      /([A-Z][a-z]+,\s*[A-Z]{2})/,
      /([A-Z][a-z]+,\s*[A-Z][a-z]+)/,
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
      /Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/,
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
      /Employment Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i,
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