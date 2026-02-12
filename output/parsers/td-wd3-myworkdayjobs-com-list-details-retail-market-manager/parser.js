/**
 * Auto-generated parser for td.wd3.myworkdayjobs.com
 * Generated at: 2026-02-10T07:56:12.920Z
 * Author: AI
 * URL: https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers/details/Retail-Market-Manager--US----Lehigh-Montgomery-Regions_R_1456219?locationCountry=bc33aa3152ec42d4995f4791a106ed09&locationCountry=29247e57dbaf46fb855b224e03170bc7&locationCountry=80938777cac5440fab50d729f9634969&locationCountry=a30a87ed25634629aa6c3958aa2b91ea&timeType=14c9322ea8e3014f4096d9d2dc025400
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';
import { ListCrawler } from '../helpers/ListCrawler.js';

export default class MyworkdayjobsComParser extends BaseParser {
  metadata = {
    name: 'MyworkdayjobsComParser',
    version: '1.0.0',
    domain: 'td.wd3.myworkdayjobs.com',
    url: 'https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'TD Bank (MyWorkday) 列表页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('myworkdayjobs.com');
  }

  async parse(browser, options) {
    return ListCrawler.crawl(browser, options, {
      companyName: 'TD Bank',

      // 翻页策略：检测到 "next" 按钮，使用 next-button 策略
      pagination: {
        strategy: 'next-button',
        keywords: ['next', 'next page'],
        waitAfter: 2000, // Workday 翻页通常需要一点时间加载
      },

      // 描述清洗：根据 Workday 特征配置
      descriptionOptions: {
        startMarkers: [
          'Job Description',
          'About the Job',
          'Job Summary',
          'Responsibilities',
          'What You\'ll Do',
        ],
        endMarkers: [
          'Similar Jobs',
          'Related Jobs',
          'Share this job',
          'Privacy Policy',
          'Cookie Settings',
          'Follow us',
          'Report Job',
        ],
      },

      // 自 Workday 页面文本特征提取
      customExtractors: {
        location: (rawText) => {
          // Workday 格式: "locationsMount Laurel, New Jersey" 或 "Work Location:..."
          const patterns = [
            /locations\s*([A-Za-z\s,]+(?:United States|Canada|USA|UK)[A-Za-z\s,]*)/i,
            /Work Location:\s*([A-Za-z0-9\s,.-]+)/i,
            /Location:\s*([A-Za-z][A-Za-z0-9 ,]{3,60})/i,
          ];
          for (const p of patterns) {
            const m = rawText.match(p);
            if (m && m[1]) {
              const loc = m[1].trim();
              // 过滤掉过短或明显错误的匹配
              if (loc.length > 3 && loc.length < 100) return loc;
            }
          }
          return '';
        },

        postDate: (rawText) => {
          // Workday 格式: "posted onPosted Today" 或 "posted onPosted 1/12/25"
          const m = rawText.match(/posted onPosted\s*([\w\s\d/]+)/i);
          if (m) return m[1].trim();
          
          // 备用格式
          const m2 = rawText.match(/Posted:\s*([\d\w\s]{10,30})/i);
          return m2 ? m2[1].trim() : '';
        },

        jobType: (rawText) => {
          // Workday 格式: "time typeFull time"
          const m = rawText.match(/time type\s*(Full time|Part time|Contract|Permanent|Internship)/i);
          if (m) return m[1].trim();
          
          // 备用格式
          const m2 = rawText.match(/Job Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i);
          return m2 ? m2[1].trim() : '';
        },

        salary: (rawText) => {
          // Workday 格式: "Pay Details:$200,000 - $225,000 USD"
          const m = rawText.match(/Pay Details:\s*([$\d,\s.-]+USD)/i);
          if (m) return m[1].trim();
          
          // 通用货币格式
          const m2 = rawText.match(/\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s*[-–to]\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s*(?:USD|CAD|GBP|EUR)/i);
          return m2 ? m2[0].trim() : '';
        },
      },
    }, (data) => this.createJobData(data));
  }

  getDefaults() {
    return { maxItems: 100, maxPages: 10 };
  }
}