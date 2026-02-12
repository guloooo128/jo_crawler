/**
 * Auto-generated parser for www.brattle.com
 * Generated at: 2026-02-10T08:08:37.291Z
 * Author: AI
 * URL: https://www.brattle.com/careers/current-openings/
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';
import { ListCrawler } from '../helpers/ListCrawler.js';

export default class BrattleComParser extends BaseParser {
  metadata = {
    name: 'BrattleComParser',
    version: '1.0.0',
    domain: 'www.brattle.com',
    url: 'https://www.brattle.com/careers/current-openings/',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'The Brattle Group 列表页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('brattle.com') && url.includes('careers');
  }

  async parse(browser, options) {
    return ListCrawler.crawl(browser, options, {
      companyName: 'The Brattle Group',

      // 翻页策略：尝试 URL 参数翻页 (?page=2)，如果失败则回退到 auto
      pagination: {
        strategy: 'url-param',
        waitAfter: 2000,
      },

      // 描述清洗：根据咨询公司网站常见结构配置
      descriptionOptions: {
        startMarkers: [
          'Job Description', 'Overview', 'About This Role',
          'Responsibilities', 'Qualifications', 'Requirements',
          'Your Role', 'What You’ll Do',
        ],
        endMarkers: [
          'Similar Jobs', 'Related Jobs', 'Share this job',
          'Privacy Policy', 'Cookie Settings', 'Footer',
          'Contact Us', 'Back to top',
        ],
      },

      // 自定义字段提取器
      customExtractors: {
        location: (rawText) => {
          // 匹配 "City, State" 或 "City, Country" 格式
          const m = rawText.match(/Location:\s*([A-Z][a-zA-Z\s]+,\s*[A-Z][a-zA-Z\s]+)/i)
            || rawText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*(?:USA|US|UK|China|Germany|France|Italy|Spain|Canada|Australia))/);
          return m ? m[1].trim() : '';
        },

        post: (rawText) => {
          const m = rawText.match(/Date Posted:\s*([\w\s]{5,30})/i)
            || rawText.match(/Posted:\s*([\w\s]{5,30})/i);
          return m ? m[1].trim() : '';
        },

        jobType: (rawText) => {
          const m = rawText.match(/Employment Type:\s*(Full-time|Part-time|Contract|Permanent|Internship|Regular)/i)
            || rawText.match(/Job Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i);
          return m ? m[1].trim() : '';
        },
      },
    }, (data) => this.createJobData(data));
  }

  getDefaults() {
    return { maxItems: 100, maxPages: 10 };
  }
}