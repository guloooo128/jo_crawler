/**
 * Auto-generated parser for cibc.wd3.myworkdayjobs.com
 * Generated at: 2026-02-10T07:57:16.234Z
 * Author: AI
 * URL: https://cibc.wd3.myworkdayjobs.com/en-US/campus
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';
import { ListCrawlerRenderer } from '../helpers/ListCrawlerRenderer.js';

export default class CibcWorkdayParser extends BaseParser {
  metadata = {
    name: 'CibcWorkdayParser',
    version: '1.0.0',
    domain: 'cibc.wd3.myworkdayjobs.com',
    url: 'https://cibc.wd3.myworkdayjobs.com/en-US/campus',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'CIBC Workday 列表页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('cibc.wd3.myworkdayjobs.com');
  }

  async parse(browser, options) {
    return ListCrawlerRenderer.crawl(browser, options, {
      companyName: 'CIBC',

      pagination: {
        strategy: 'next-button',
        keywords: ['next'],
        waitAfter: 2000,
      },

      descriptionOptions: {
        startMarkers: [
          'We’re building a relationship-oriented bank',
          'CIBC’s Summer Internship Program',
          'Job Description',
          'About the Role',
          'Responsibilities',
        ],
        endMarkers: [
          'Similar Jobs',
          'Related Jobs',
          'Share this job',
          'Privacy Policy',
          'Cookie Settings',
          'Follow us',
          'Facebook',
          'LinkedIn',
        ],
      },

      customExtractors: {
        location: (rawText) => {
          // 匹配 "locationsMiami, FL" 或 "Location: Miami, FL"
          const m = rawText.match(/locations\s*([A-Za-z\s,.-]+?)(?=time type|posted on|job requisition|$)/i)
            || rawText.match(/Location:\s*([A-Za-z\s,.-]+?)(?=time type|posted on|$)/i);
          if (m) {
            let loc = m[1].trim();
            // 移除常见的后缀噪音
            loc = loc.replace(/time type.*/i, '').replace(/posted on.*/i, '').trim();
            if (loc.length > 3 && loc.length < 100) return loc;
          }
          return '';
        },

        postDate: (rawText) => {
          // 匹配 "posted onPosted Today" 或 "posted onPosted 1 Days Ago"
          const m = rawText.match(/posted on(Posted\s+\w+(?:\s+\w+)?)/i);
          if (m) return m[1].trim();
          
          // 备用：匹配 "Posted Today" 或 "Posted 2 Days Ago"
          const m2 = rawText.match(/Posted\s+(Today|\d+\s+\w+\s+ago)/i);
          return m2 ? m2[0].trim() : '';
        },

        jobType: (rawText) => {
          // 匹配 "time typeFull time"
          const m = rawText.match(/time type\s*(Full time|Part time|Contract|Internship)/i);
          return m ? m[1].trim() : '';
        },
      },
    }, (data) => this.createJobData(data));
  }

  getDefaults() {
    return { maxItems: 50, maxPages: 5 };
  }
}