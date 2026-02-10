/**
 * Auto-generated parser for cibc.wd3.myworkdayjobs.com
 * Generated at: 2026-02-10T06:33:41.762Z
 * Author: AI (GLM-4.7)
 * URL: https://cibc.wd3.myworkdayjobs.com/en-US/campus
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class CibcMyworkdayjobsParser extends BaseParser {
  metadata = {
    name: 'CibcMyworkdayjobsParser',
    version: '1.0.0',
    domain: 'cibc.wd3.myworkdayjobs.com',
    url: 'https://cibc.wd3.myworkdayjobs.com/en-US/campus',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'CIBC Campus Workday 列表页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('cibc.wd3.myworkdayjobs.com');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 50, maxPages = 5 } = options;

    const listUrl = await browser.getCurrentUrl();
    let allJobLinks = [];
    let currentPage = 1;

    // === 阶段一：翻页收集所有职位URL ===
    while (currentPage <= maxPages && allJobLinks.length < maxItems) {
      console.log('📄 第 ' + currentPage + ' 页...');

      const { tree, refs } = await browser.getSnapshot({ interactive: true, maxDepth: 5 });

      // ✅ 使用 LLM 智能识别职位链接
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
      const pageLinks = await this. collectJobLinks(browser, jobRefs);
      console.log('🔗 收集到 ' + pageLinks.length + ' 个职位链接');

      // 去重合并
      const existingUrls = new Set(allJobLinks.map(l => l.url));
      const newLinks = pageLinks.filter(l => !existingUrls.has(l.url));
      allJobLinks.push(...newLinks);

      if (newLinks.length == 0) break;
      if (allJobLinks.length >= maxItems) break;

      // === 翻页逻辑 ===
      // 优先查找 "next" 按钮
      const nextBtn = Object.entries(refs).find(([k, r]) =>
        (r.role == 'link' || r.role == 'button') && /next|下一页|›|»/i.test(r.name || '')
      );

      if (nextBtn) {
        console.log('➡️ 点击下一页');
        await browser.click('@' + nextBtn[0]);
        await this.delay(2000);
        currentPage++;
        continue;
      } else {
        console.log('⚠️ 未找到下一页按钮，停止翻页');
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

    // Workday 特征：正文通常在 "We're building" 或 "Job Description" 之后
    const startMarkers = [
      'Job Description',
      'About the Job',
      'We’re building a relationship-oriented bank',
      "We're building a relationship-oriented bank",
      'At CIBC, we embrace your strengths',
      'CIBC’s Summer Internship Program'
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
      'Help',
      'Report a problem'
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
    // Workday 格式: "locationsMiami, FL" 或 "location: Miami, FL"
    const patterns = [
      /locations\s*([A-Za-z\s,.-]+)\s*time/i,
      /location:\s*([A-Za-z\s,.-]+)\s*time/i,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z]{2})/,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z][a-z]+)/,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1]) {
        const loc = m[1].trim();
        if (loc.length > 2 && loc.length < 60) {
          return loc;
        }
      }
    }

    return '';
  }

  extractPostDate(text) {
    // Workday 格式: "posted onPosted Today" 或 "posted onPosted 1/15/2026"
    const patterns = [
      /posted onPosted\s*(Today|\d{1,2}\/\d{1,2}\/\d{4}|\w+\s+\d{1,2},\s+\d{4})/i,
      /Posted:\s*(Today|\d{1,2}\/\d{1,2}\/\d{4})/i,
      /Date Posted:\s*(\d{4}-\d{2}-\d{2})/,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }

    return '';
  }

  extractJobType(text) {
    // Workday 格式: "time typeFull time"
    const patterns = [
      /time type\s*(Full time|Part time|Contract|Permanent|Internship)/i,
      /Job Type:\s*(Full time|Part time|Contract|Permanent|Internship)/i,
      /Employment Type:\s*(Full time|Part time|Contract)/i,
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