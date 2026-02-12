/**
 * Auto-generated parser for careers.shopee.sg
 * Generated at: 2026-02-10T09:38:36.047Z
 * Author: AI
 * URL: https://careers.shopee.sg/jobs?region_id=25&level=4&name=&limit=50&offset=0
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';
import { ListCrawler } from '../helpers/ListCrawler.js';

export default class ShopeeSgParser extends BaseParser {
  metadata = {
    name: 'ShopeeSgParser',
    version: '1.0.0',
    domain: 'careers.shopee.sg',
    url: 'https://careers.shopee.sg/jobs',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'Shopee Singapore 列表页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('careers.shopee.sg');
  }

  async parse(browser, options) {
    return ListCrawler.crawl(browser, options, {
      companyName: 'Shopee',

      // 翻页策略：URL 参数翻页
      pagination: {
        strategy: 'url-param',
        param: 'offset',
        step: 50,
        waitAfter: 2000,
      },

      // 描述清洗配置
      descriptionOptions: {
        startMarkers: [
          'Job Description', 'Overview', 'About This Role',
          'Responsibilities', 'What You\'ll Do', 'Your Role',
          'Job Responsibilities',
        ],
        endMarkers: [
          'Similar Jobs', 'Related Jobs', 'Share this job',
          'Privacy Policy', 'Cookie Settings', 'Follow us',
          'Apply Now',
        ],
      },

      // 自定义字段提取器
      customExtractors: {
        location: (rawText) => {
          const patterns = [
            /Location:\s*([A-Za-z][A-Za-z0-9 ,]+)/i,
            /([A-Z][a-z]+(?:,\s*[A-Z]{2})?)/,
          ];
          for (const p of patterns) {
            const m = rawText.match(p);
            if (m && m[1].length > 3 && m[1].length < 60) return m[1].trim();
          }
          return 'Singapore'; // 默认新加坡
        },

        postDate: (rawText) => {
          const m = rawText.match(/Posted:\s*(\d{1,2}\s+\w+\s+\d{4})/i)
            || rawText.match(/Date Posted:\s*(\d{4}-\d{2}-\d{2})/);
          return m ? m[1].trim() : '';
        },

        jobType: (rawText) => {
          const m = rawText.match(/Job Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i);
          return m ? m[1].trim() : '';
        },
      },
    }, (data) => this.createJobData(data));
  }

  getDefaults() {
    return { maxItems: 50, maxPages: 5 };
  }
}