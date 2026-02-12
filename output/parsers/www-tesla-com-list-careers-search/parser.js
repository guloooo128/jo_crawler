/**
 * Auto-generated parser for www.tesla.com
 * Generated at: 2026-02-10T08:27:24.381Z
 * Author: AI
 * URL: https://www.tesla.com/careers/search/?type=fulltime&site=GB
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';
import { ListCrawler } from '../helpers/ListCrawler.js';

export default class TeslaComParser extends BaseParser {
  metadata = {
    name: 'TeslaComParser',
    version: '1.0.0',
    domain: 'tesla.com',
    url: 'https://www.tesla.com/careers/search',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'Tesla 列表页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('tesla.com/careers');
  }

  async parse(browser, options) {
    return ListCrawler.crawl(browser, options, {
      companyName: 'Tesla',

      // 翻页策略：Tesla 使用 URL 参数翻页 (?page=2)
      pagination: {
        strategy: 'url-param',
        waitAfter: 2000,
      },

      // 描述清洗：根据详情页样本文本特征定制
      descriptionOptions: {
        startMarkers: [
          'What to Expect',
          'What You’ll Do',
          'What You\'ll Do',
          'Responsibilities',
          'About This Role',
        ],
        endMarkers: [
          'Similar Jobs',
          'Related Jobs',
          'Apply Now',
          'Share this job',
          'Privacy Policy',
          'Cookie Settings',
          'Follow us',
        ],
      },

      // 弹窗关闭：Tesla 可能有地区选择弹窗，尝试关闭
      dismissPopup: async (browser, refs) => {
        // 尝试查找关闭按钮或模态框遮罩
        const closeBtn = Object.entries(refs).find(([k, r]) =>
          (r.role === 'button' && /close|dismiss|skip/i.test(r.name || '')) ||
          (r.role === 'link' && /skip to main content/i.test(r.name || ''))
        );
        if (closeBtn) {
          try {
            await browser.click('@' + closeBtn[0]);
          } catch (e) {
            // 忽略点击失败
          }
        }
      },

      // 自定义字段提取器
      customExtractors: {
        location: (rawText) => {
          // 匹配 "Location: London, England" 或 "London, England"
          const m = rawText.match(/Location:\s*([A-Za-z][A-Za-z0-9 ,\-]{3,60})/i);
          if (m) return m[1].trim();
          // 备用：匹配城市+国家/州格式
          const m2 = rawText.match(/([A-Z][a-z]+(?:,\s*[A-Z][a-z]+|\s+[A-Z]{2}))/);
          return m2 ? m2[1].trim() : '';
        },

        postDate: (rawText) => {
          // Tesla 详情页通常没有明确的发布日期，尝试通用匹配
          const m = rawText.match(/Posted:\s*([\d\w\s]{10,30})/i);
          return m ? m[1].trim() : '';
        },

        jobType: (rawText) => {
          // 匹配 "Job Type: Full-time"
          const m = rawText.match(/Job Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i);
          return m ? m[1].trim() : '';
        },
      },
    }, (data) => this.createJobData(data));
  }

  getDefaults() {
    return { maxItems: 100, maxPages: 10 };
  }
}