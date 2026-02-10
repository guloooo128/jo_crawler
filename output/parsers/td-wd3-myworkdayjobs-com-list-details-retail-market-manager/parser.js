/**
 * Auto-generated parser for td.wd3.myworkdayjobs.com
 * Generated at: 2026-02-10T06:32:14.139Z
 * Author: AI (GLM-4.7)
 * URL: https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers/details/Retail-Market-Manager--US----Lehigh-Montgomery-Regions_R_1456219?locationCountry=bc33aa3152ec42d4995f4791a106ed09&locationCountry=29247e57dbaf46fb855b224e03170bc7&locationCountry=80938777cac5440fab50d729f9634969&locationCountry=a30a87ed25634629aa6c3958aa2b91ea&timeType=14c9322ea8e3014f4096d9d2dc025400
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class MyworkdayjobsComParser extends BaseParser {
  metadata = {
    name: 'MyworkdayjobsComParser',
    version: '1.0.0',
    domain: 'td.wd3.myworkdayjobs.com',
    url: 'https://td.wd3.myworkdayjobs.com',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'TD Bank Workday 列表页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('myworkdayjobs.com');
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
      const pageLinks = await this.collectJobLinks(browser, jobRefs);
      console.log('🔗 收集到 ' + pageLinks.length + ' 个职位链接');

      // 去重合并
      const existingUrls = new Set(allJobLinks.map(l => l.url));
      const newLinks = pageLinks.filter(l => !existingUrls.has(l.url));
      allJobLinks.push(...newLinks);

      if (newLinks.length == 0) break;
      if (allJobLinks.length >= maxItems) break;

      // === 翻页逻辑 ===
      // Workday 通常使用 "next" 按钮或页码按钮
      const nextBtn = Object.entries(refs).find(([k, r]) =>
        (r.role == 'button' || r.role == 'link') && /next/i.test(r.name || '')
      );

      if (nextBtn) {
        await browser.click('@' + nextBtn[0]);
        await this.delay(2000);
        currentPage++;
        continue;
      } else {
        console.log('⚠️  未找到下一页按钮，停止翻页');
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

    // 移除标题部分，避免干扰
    if (title) {
      const titleIdx = text.indexOf(title);
      if (titleIdx != -1) {
        text = text.substring(titleIdx + title.length);
      }
    }

    // Workday 特征：通常以 "Job Description:" 或 "About the Job:" 开头
    const startMarkers = [
      'Job Description:',
      'Job Description',
      'About the Job:',
      'About This Role',
      'Responsibilities',
      'What You\'ll Do'
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

    // 清理结尾噪音
    const endMarkers = [
      'Similar Jobs',
      'Related Jobs',
      'Share this job',
      'Privacy Policy',
      'Cookie Settings',
      'Follow us',
      'Unsubscribe',
      'Job requisition id', // Workday 特征
      'Pay Details' // Workday 特征，通常在描述前
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
    // Workday 格式: "locationsMount Laurel, New Jersey" 或 "Work Location:Mount Laurel, New Jersey"
    const patterns = [
      /locations\s*([A-Z][a-zA-Z\s,]+(?:\s+[A-Z]{2})?)/i,
      /Work Location:\s*([A-Za-z][A-Za-z0-9 ,.-]+)/i,
      /Location:\s*([A-Za-z][A-Za-z0-9 ,.-]+)/i,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+),\s*[A-Z]{2})/ // City, State
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1]) {
        let loc = m[1].trim();
        // 移除常见的后缀噪音
        loc = loc.replace(/time type.*/i, '').replace(/posted on.*/i, '').trim();
        if (loc.length > 3 && loc.length < 100) {
          return loc;
        }
      }
    }

    return '';
  }

  extractPostDate(text) {
    // Workday 格式: "posted onPosted Today" 或 "posted onPosted Date"
    const patterns = [
      /posted onPosted\s+(Today|\d{1,2}\/\d{1,2}\/\d{4}|[A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
      /Posted:\s*(\d{1,2}\s+\w+\s+\d{4})/i,
      /Date Posted:\s*(\d{4}-\d{2}-\d{2})/,
      /Posted\s+(\d+\s+days?\s+ago)/i
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
      /time type\s*(Full time|Part time|Contract|Internship|Permanent)/i,
      /Employment Type:\s*(Full time|Part time|Contract|Internship)/i,
      /Job Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }

    return '';
  }

  extractSalary(text) {
    // Workday 格式: "Pay Details:$200,000 - $225,000 USD"
    const patterns = [
      /Pay Details:\s*([$€£][\d,,-]+(?:\s*[-–]\s*[$€£][\d,,-]+)?)/i,
      /Salary:\s*([$€£][\d,,-]+(?:\s*[-–]\s*[$€£][\d,,-]+)?)/i,
      /Compensation:\s*([$€£][\d,,-]+(?:\s*[-–]\s*[$€£][\d,,-]+)?)/i
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