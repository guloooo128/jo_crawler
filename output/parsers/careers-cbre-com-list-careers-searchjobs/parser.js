/**
 * Auto-generated parser for careers.cbre.com
 * Generated at: 2026-02-10T06:28:35.454Z
 * Author: AI (GLM-4.7)
 * URL: https://careers.cbre.com/en_US/careers/SearchJobs/?9577=%5B17134%5D&9577_format=10224&listFilterMode=1&jobSort=relevancy&jobRecordsPerPage=25&
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class CbreComParser extends BaseParser {
  metadata = {
    name: 'CbreComParser',
    version: '1.0.0',
    domain: 'careers.cbre.com',
    url: 'https://careers.cbre.com/en_US/careers/SearchJobs/',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'CBRE Careers 列表页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('careers.cbre.com');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 50, maxPages = 5 } = options;

    // Dismiss cookies if present
    try {
      const { refs } = await browser.getSnapshot({ interactive: true, maxDepth: 3 });
      const rejectBtn = Object.entries(refs).find(([k, r]) =>
        r.role == 'button' && /reject all/i.test(r.name || '')
      );
      if (rejectBtn) {
        await browser.click('@' + rejectBtn[0]);
        await this.delay(1000);
      }
    } catch (e) {
      // Ignore cookie errors
    }

    const listUrl = await browser.getCurrentUrl();
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

      // === 翻页逻辑 ===
      const nextBtn = Object.entries(refs).find(([k, r]) =>
        (r.role == 'link' || r.role == 'button') && /next|下一页|go to next/i.test(r.name || '')
      );

      if (nextBtn) {
        await browser.click('@' + nextBtn[0]);
        await this.delay(2000);
        currentPage++;
        continue;
      } else {
        // 尝试URL参数翻页
        const nextPageUrl = listUrl.includes('?')
          ? listUrl + '&page=' + (currentPage + 1)
          : listUrl + '?page=' + (currentPage + 1);
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

  cleanDescription(rawText, title) {
    if (!rawText) return '';

    let text = rawText;

    // 移除标题部分，避免重复
    if (title) {
      const titleIdx = text.indexOf(title);
      if (titleIdx != -1) {
        text = text.substring(titleIdx + title.length);
      }
    }

    // 找正文起点 (CBRE 特有: About the Role)
    const startMarkers = [
      'About the Role',
      'Job Description',
      'Overview',
      'What You’ll Do',
      'Responsibilities'
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
      'Return to Search'
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
    // CBRE 格式: Location(s) \n Hong Kong - Hong Kong
    const patterns = [
      /Location\(s\)\s*([^\n]+)/i,
      /Location:\s*([^\n]+)/i,
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
    // CBRE 格式: Posted \n 05-Feb-2026
    const patterns = [
      /Posted\s*([A-Za-z0-9\-]+)/i,
      /Date Posted:\s*(\d{4}-\d{2}-\d{2})/,
      /Posted:\s*(\d{1,2}\s+\w+\s+\d{4})/i,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }

    return '';
  }

  extractJobType(text) {
    // CBRE 格式: Role type \n Full-time
    const patterns = [
      /Role type\s*([^\n]+)/i,
      /Job Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i,
      /Employment:\s*(Full-time|Part-time|Contract)/i,
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