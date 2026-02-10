/**
 * Auto-generated parser for www.capgemini.com
 * Generated at: 2026-02-10T06:30:32.970Z
 * Author: AI (GLM-4.7)
 * URL: https://www.capgemini.com/careers/join-capgemini/job-search/?size=15
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class CapgeminiComParserParser extends BaseParser {
  metadata = {
    name: 'CapgeminiComParserParser',
    version: '1.0.0',
    domain: 'www.capgemini.com',
    url: 'https://www.capgemini.com/careers/join-capgemini/job-search/',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'Capgemini 列表页解析器，支持 Load More 翻页',
  };

  canParse(_snapshot, url) {
    return url.includes('capgemini.com') && url.includes('job-search');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 50, maxPages = 5 } = options;

    let allJobLinks = [];
    let currentPage = 1;

    // === 阶段一：翻页收集所有职位URL ===
    while (currentPage <= maxPages && allJobLinks.length < maxItems) {
      console.log('📄 第 ' + currentPage + ' 页...');

      const { tree, refs } = await browser.getSnapshot({ interactive: true, maxDepth: 5 });

      // ✅ 推荐：使用 LLM 智能识别职位链接
      const jobLinks = await browser.llmIdentifyJobLinks(tree, refs);
      console.log('🤖 LLM 识别到 ' + jobLinks.length + ' 个职位链接');

      if (jobLinks.length == 0) {
        console.log('⚠️  LLM 未识别到职位链接，尝试 HTML 解析...');
        const htmlLinks = await browser.getJobLinksFromHTML();
        if (htmlLinks.length > 0) {
          for (const link of htmlLinks) {
            allJobLinks.push({ url: link.url, name: link.name });
          }
        }
        break;
      }

      // 转换 LLM 返回格式为 collectJobLinks 需要的格式
      const jobRefs = jobLinks.map(jl => [jl.ref.replace('@', ''), { role: 'link', name: jl.name }]);
      const pageLinks = await this.collectJobLinks(browser, jobRefs);
      console.log('🔗 收集到 ' + pageLinks.length + ' 个职位链接');

      // 去重合并
      const existingUrls = new Set(allJobLinks.map(l => l.url));
      const newLinks = pageLinks.filter(l => !existingUrls.has(l.url));
      allJobLinks.push(...newLinks);

      if (newLinks.length == 0) break;
      if (allJobLinks.length >= maxItems) break;

      // === 翻页逻辑：点击 Load More ===
      const loadMoreBtn = Object.entries(refs).find(([k, r]) =>
        r.role == 'button' && /load more/i.test(r.name || '')
      );

      if (loadMoreBtn) {
        console.log('🖱️  点击 Load More...');
        await browser.click('@' + loadMoreBtn[0]);
        await this.delay(3000); // 等待内容加载
        currentPage++;
        continue;
      } else {
        console.log('🛑 未找到 Load More 按钮，翻页结束');
        break;
      }
    }

    console.log('✅ 共收集 ' + allJobLinks.length + ' 个职位链接');

    // === 阶段二：逐个导航提取 ===

    for (const link of allJobLinks.slice(0, maxItems)) {
      try {
        console.log('🚀 提取: ' + link.name);

        const titleFromList = link.name;

        await browser.navigate(link.url);
        await this.delay(2000);

        // 自己提取 description
        let rawText = '';
        try {
          rawText = await browser.getMainContentText();
        } catch (e) {
          rawText = await browser.getCleanPageText();
        }
        const description = this.cleanDescription(rawText,);

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
      'Responsibilities', 'What You\'ll Do', 'Your Role', 'Your mission'
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
      'Privacy Policy', 'Cookie Settings', 'Follow us', 'Apply now'
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
    // 尝试从文本中提取地点，通常包含 City, Country 格式
    const patterns = [
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z][a-z]+)/, // City, Country
      /Location:\s*([A-Za-z][A-Za-z0-9 ,]+)/i,
      /([A-Z][a-z]+,\s*[A-Z]{2})/, // US State format
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
      /Published:\s*(\d{1,2}\/\d{1,2}\/\d{4})/,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }

    return '';
  }

  extractJobType(text) {
    const patterns = [
      /Job Type:\s*(Full-time|Part-time|Contract|Permanent|Internship|Fixed Term Contract)/i,
      /Employment Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i,
      /Contract Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i,
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