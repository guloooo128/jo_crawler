/**
 * Auto-generated parser for www.capgemini.com
 * Generated at: 2026-02-10T03:40:21.406Z
 * Author: AI (GLM-4.7)
 * URL: https://www.capgemini.com/careers/join-capgemini/job-search/?size=15
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class CapgeminiComParser extends BaseParser {
  metadata = {
    name: 'CapgeminiComParser',
    version: '1.0.0',
    domain: 'www.capgemini.com',
    url: 'https://www.capgemini.com/careers/join-capgemini/job-search/',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'Capgemini 列表页解析器 (Load More 模式)',
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

      // 根据快照分析编写过滤逻辑
      // Capgemini 的职位链接通常包含 "Experienced Professionals", "Permanent" 等关键词，且长度较长
      const skipKeywords = ['facebook', 'linkedin', 'youtube', 'instagram', 'glassdoor', 'cookie', 'privacy', 'terms', 'contact', 'investors', 'accessibility', 'insights', 'industries', 'services', 'careers', 'news', 'about us', 'speakup', 'frog', 'sogeti', 'capgemini invent', 'capgemini engineering'];
      const jobRefs = Object.entries(refs).filter(([key, ref]) => {
        if (ref.role != 'link' || !ref.name) return false;
        // 过滤掉太短或太长的非职位链接
        if (ref.name.length < 30) return false;
        
        const nameLower = ref.name.toLowerCase();
        // 排除页脚和导航链接
        if (skipKeywords.some(kw => nameLower.includes(kw))) return false;
        
        // 职位链接通常包含职位类型关键词
        const jobKeywords = ['experienced professionals', 'permanent', 'internship', 'contract', 'student'];
        return jobKeywords.some(kw => nameLower.includes(kw));
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
      // 查找 "Load More" 按钮
      const loadMoreBtn = Object.entries(refs).find(([k, r]) =>
        r.role == 'button' && /load more/i.test(r.name || '')
      );

      if (loadMoreBtn) {
        console.log('🔄 点击 Load More...');
        await browser.click('@' + loadMoreBtn[0]);
        await this.delay(3000); // 等待内容加载
        currentPage++;
        continue;
      } else {
        console.log('⚠️ 未找到 Load More 按钮，翻页结束');
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
        const location = this.extractLocation(rawText, titleFromList);
        const postDate = this.extractPostDate(rawText);
        const jobType = this.extractJobType(rawText, titleFromList);

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

  cleanDescription(rawText, titleFromList) {
    if (!rawText) return '';

    let text = rawText;

    // 找正文起点
    // Capgemini 详情页通常以 "Descripción larga" 或 "YOUR ROLE" 开头
    const startMarkers = [
      'Descripción larga',
      'Job Description', 
      'Overview', 
      'About This Role',
      'Responsibilities', 
      'What You\'ll Do', 
      'Your Role',
      'YOUR ROLE'
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
      'Return to search'
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

  extractLocation(text, titleFromList) {
    // 优先从标题中提取 (Capgemini 标题包含地点，如 "Ukraine Kyiv")
    if (titleFromList) {
      // 尝试匹配 "Country City" 模式
      const titleMatch = titleFromList.match(/([A-Z][a-zA-Z\s]+)\s+(Experienced|Permanent|Internship|Contract)/);
      if (titleMatch && titleMatch[1]) {
        let loc = titleMatch[1].trim();
        if (loc.length > 3 && loc.length < 100) return loc;
      }
    }

    // 从正文中提取
    const patterns = [
      /Location:\s*([A-Za-z][A-Za-z0-9 ,]+)/i,
      /Country:\s*([A-Za-z][A-Za-z0-9 ,]+)/i,
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
      /Publication date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }

    return '';
  }

  extractJobType(text, titleFromList) {
    // 优先从标题中提取 (Capgemini 标题包含类型，如 "Permanent")
    if (titleFromList) {
      if (titleFromList.includes('Permanent')) return 'Permanent';
      if (titleFromList.includes('Contract')) return 'Contract';
      if (titleFromList.includes('Internship')) return 'Internship';
      if (titleFromList.includes('Experienced')) return 'Full-time'; // 默认为全职
    }

    // 从正文中提取
    const patterns = [
      /Job Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i,
      /Employment Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i,
      /Contract Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i,
    ];

    for (const p of patterns) {
      for (const p of patterns) {
        const m = text.match(p);
        if (m) return m[1].trim();
      }
    }

    return '';
  }

  getDefaults() {
    return { maxItems: 50, maxPages: 5 };
  }
}