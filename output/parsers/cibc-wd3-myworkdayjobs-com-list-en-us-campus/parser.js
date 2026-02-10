/**
 * Auto-generated parser for cibc.wd3.myworkdayjobs.com
 * Generated at: 2026-02-10T03:42:54.487Z
 * Author: AI (GLM-4.7)
 * URL: https://cibc.wd3.myworkdayjobs.com/en-US/campus
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class CibcWd3MyworkdayjobsComParser extends BaseParser {
  metadata = {
    name: 'CibcWd3MyworkdayjobsComParser',
    version: '1.0.0',
    domain: 'cibc.wd3.myworkdayjobs.com',
    url: 'https://cibc.wd3.myworkdayjobs.com/en-US/campus',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'CIBC Campus Jobs 列表页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('cibc.wd3.myworkdayjobs.com');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 50, maxPages = 5 } = options;

    let allJobLinks = [];
    let currentPage = 1;

    // === 阶段一：翻页收集所有职位URL ===
    while (currentPage <= maxPages && allJobLinks.length < maxItems) {
      console.log('📄 第 ' + currentPage + ' 页...');

      const { tree, refs } = await browser.getSnapshot({ interactive: true, maxPages });

      // 过滤逻辑：排除非职位链接
      // 职位链接通常包含年份、城市、职位名称，长度适中
      const skipKeywords = [
        'skip to', 'search for jobs', 'sign in', 'facebook', 'youtube', 
        'linkedin', 'glassdoor', 'google plus', 'direct applicant portal'
      ];
      
      const jobRefs = Object.entries(refs).filter(([key, ref]) => {
        if (ref.role != 'link' || !ref.name) return false;
        
        const nameLower = ref.name.toLowerCase();
        // 排除导航和页脚链接
        if (skipKeywords.some(kw => nameLower.includes(kw))) return false;
        
        // 职位标题通常较长且包含特定关键词
        if (ref.name.length < 15) return false;
        
        // Workday 职位链接通常包含特定模式，这里主要依赖文本特征
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
      // 查找 "next" 按钮
      const nextBtn = Object.entries(refs).find(([k, r]) =>
        (r.role == 'button') && /next/i.test(r.name || '')
      );

      if (nextBtn) {
        await browser.click('@' + nextBtn[0]);
        await this.delay(2000); // 等待页面加载
        currentPage++;
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
        await this.delay(2000); // 等待详情页加载

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
          source: 'CIBC',
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
    if (title && text.includes(title)) {
      text = text.replace(title, '');
    }

    // Workday 详情页通常在 "We’re building..." 或 "At CIBC..." 开始
    // 也可以通过移除顶部元数据后的内容作为正文
    const startMarkers = [
      'We’re building a relationship-oriented bank',
      'At CIBC, we embrace',
      'CIBC’s Summer Internship Program',
      'Job Description',
      'About the Role'
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
      'Unsubscribe'
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
    // Workday 格式: "locationsMiami, FL" 或 "locationsToronto, ON"
    // 尝试匹配 "locations" 后面的内容
    const locPattern = /locations([A-Za-z\s,.-]+)/i;
    const match = text.match(locPattern);
    if (match && match[1]) {
      // 清理可能紧跟的单词，如 "time type"
      let loc = match[1].replace(/time type.*/i, '').trim();
      if (loc.length > 2 && loc.length < 60) return loc;
    }

    // 备用通用模式
    const patterns = [
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
    // Workday 格式: "posted onPosted Today" 或 "posted onPosted Date"
    const pattern = /posted on(.*?)(?=time type|job requisition|$)/i;
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // 备用
    const backup = /Posted:\s*(.*)/i;
    const m2 = text.match(backup);
    if (m2) return m2[1].trim();

    return '';
  }

.extractJobType(text) {
    // Workday 格式: "time typeFull time"
    const pattern = /time type([A-Za-z\s-]+)/i;
    const match = text.match(pattern);
    if (match && match[1]) {
      let type = match[1].replace(/posted on.*/i, '').trim();
      // 标准化
      if (type.toLowerCase() == 'full time') return 'Full-time';
      if (type.toLowerCase() == 'part time') return 'Part-time';
      return type;
    }

    return '';
  }

  getDefaults() {
    return { maxItems: 50, maxPages: 5 };
  }
}