/**
 * Auto-generated parser for td.wd3.myworkdayjobs.com
 * Generated at: 2026-02-10T03:41:42.724Z
 * Author: AI (GLM-4.7)
 * URL: https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers/details/Retail-Market-Manager--US----Lehigh-Montgomery-Regions_R_1456219?locationCountry=bc33aa3152ec42d4995f4791a106ed09&locationCountry=29247e57dbaf46fb855b224e03170bc7&locationCountry=80938777cac5440fab50d729f9634969&locationCountry=a30a87ed25634629aa6c3958aa2b91ea&timeType=14c9322ea8e3014f4096d9d2dc025400
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class TdWd3MyworkdayjobsComParser extends BaseParser {
  metadata = {
    name: 'TdWd3MyworkdayjobsComParser',
    version: '1.0.0',
    domain: 'td.wd3.myworkdayjobs.com',
    url: 'https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'TD Bank Workday 列表页解析器 (左侧列表，右侧详情)',
  };

  canParse(_snapshot, url) {
    return url.includes('td.wd3.myworkdayjobs.com');
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

      // 根据快照分析编写过滤逻辑
      // 过滤掉非职位链接 (如 home, privacy, linkedin 等)
      const skipKeywords = [
        'skip to', 'privacy', 'cookie', 'linkedin', 'facebook', 'careers home', 
        'sign in', 'why choose us', 'search for jobs', 'close job details'
      ];
      
      const jobRefs = Object.entries(refs).filter(([key, ref]) => {
        if (ref.role != 'link' || !ref.name) return false;
        // 长度过滤：职位标题通常较长
        if (ref.name.length < 15) return false;
        const nameLower = ref.name.toLowerCase();
        return !skipKeywords.some(kw => nameLower.includes(kw));
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
      // 优先查找 "next" 按钮
      const nextBtn = Object.entries(refs).find(([k, r]) =>
        (r.role == 'link' || r.role == 'button') && /next/i.test(r.name || '')
      );

      if (nextBtn) {
        await browser.click('@' + nextBtn[0]);
        await this.delay(2000); // 等待页面加载
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

        // 导航到详情页
        await browser.navigate(link.url);
        await this.delay(2000); // 等待详情页加载

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
        const salary = this.extractSalary(rawText);

        const jobData = this.createJobData({
          job_title: titleFromList,
          company_name: this.getCompanyName(),
          location: location,
          job_link: link.url,
          post_date: postDate,
          job_type: jobType,
          description: description,
          salary: salary,
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

    // 找正文起点
    const startMarkers = [
      'Job Description', 'Overview', 'About This Role',
      'Responsibilities', 'What You\'ll Do', 'Your Role', 'Depth & Scope'
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
      'Privacy Policy', 'Cookie Settings', 'Follow us', 'LinkedIn'
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
    // 针对 Workday 格式优化: "locationsMount Laurel, New Jersey" 或 "Work Location:..."
    const patterns = [
      /locations\s*([A-Z][a-z]+(?:,\s*[A-Z][a-z]+(?:,\s*[A-Z][a-z]+)?)?)/,
      /Work Location:\s*([^\n]+)/i,
      /Location:\s*([A-Za-z][A-Za-z0-9 ,]+)/i,
      /([A-Z][a-z]+,\s*[A-Z]{2})/,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1]) {
        let loc = m[1].trim();
        // 清理可能的后缀
        loc = loc.replace(/time type.*/i, '');
        loc = loc.replace(/posted on.*/i, '');
        if (loc.length > 3 && loc.length < 100) return loc;
      }
    }

    return '';
  }

  extractPostDate(text) {
    // 针对 Workday 格式: "posted onPosted Today" 或 "posted onPosted Date"
    const patterns = [
      /posted on(Posted\s+\w+)/i,
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
    // 针对 Workday 格式: "time typeFull time"
    const patterns = [
      /time type(Full time|Part time|Contract|Permanent|Internship)/i,
      /Job Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i,
      /Employment:\s*(Full-time|Part-time|Contract)/i,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }

    return '';
  }

  extractSalary(text) {
    // 针对 Workday 格式: "Pay Details:$200,000 - $225,000 USD"
    const patterns = [
      /Pay Details:\s*([^\n]+)/i,
      /Salary:\s*([^\n]+)/i,
      /\$\d{1,3}(?:,\d{3})*(?:\s*-\s*\$\d{1,3}(?:,\d{3})*)?/,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m) {
        let sal = m[1] ? m[1].trim() : m[0];
        if (sal.length > 3 && sal.length < 50) return sal;
      }
    }

    return '';
  }

  getDefaults() {
    return { maxItems: 50, maxPages: 5 };
  }
}