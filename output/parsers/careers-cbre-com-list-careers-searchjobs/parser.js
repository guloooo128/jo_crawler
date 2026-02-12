/**
 * Auto-generated parser for careers.cbre.com
 * Generated at: 2026-02-10T07:58:49.054Z
 * Author: AI
 * URL: https://careers.cbre.com/en_US/careers/SearchJobs/?9577=%5B17134%5D&9577_format=10224&listFilterMode=1&jobSort=relevancy&jobRecordsPerPage=25&
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';
import { ListCrawler } from '../helpers/ListCrawler.js';

export default class CbreComParser extends BaseParser {
  metadata = {
    name: 'CbreComParser',
    version: '1.0.0',
    domain: 'careers.cbre.com',
    url: 'https://careers.cbre.com/en_US/careers/SearchJobs/',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'CBRE Careers 列表页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('careers.cbre.com');
  }

  async parse(browser, options) {
    return ListCrawler.crawl(browser, options, {
      companyName: 'CBRE',

      pagination: {
        strategy: 'next-button',
        keywords: ['Go to Next Page', 'Next'],
        waitAfter: 2000,
      },

      descriptionOptions: {
        startMarkers: [
          'About the Role',
          'Job Description',
          'Overview',
          'What You’ll Do',
          'Your Role',
        ],
        endMarkers: [
          'Similar Jobs',
          'Related Jobs',
          'Share this job',
          'Privacy Policy',
          'Cookie Settings',
          'Follow us',
          'Sign Up',
        ],
      },

      dismissPopup: async (browser, refs) => {
        const cookieBtn = Object.entries(refs).find(([k, r]) =>
          r.role === 'button' && /accept all cookies|reject all/i.test(r.name || '')
        );
        if (cookieBtn) {
          try {
            await browser.click('@' + cookieBtn[0]);
            await browser.waitForTimeout(500);
          } catch (e) {
            // Ignore popup errors
          }
        }
      },

      customExtractors: {
        location: (rawText) => {
          const m = rawText.match(/Location\(s\)\s*([^\n]{5,100})/i);
          if (m) return m[1].trim();
          
          const patterns = [
            /Location:\s*([A-ZaA-Z][A-Za-z0-9 ,\-]+)/i,
            /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z]{2})/,
          ];
          for (const p of patterns) {
            const match = rawText.match(p);
            if (match && match[1].length > 3 && match[1].length < 60) return match[1].trim();
          }
          return '';
          },

        postDate: (rawText) => {
          const m = rawText.match(/Posted\s*([^\n]{8,30})/i);
          if (m) return m[1].trim();

          const fallback = rawText.match(/Posted:\s*(\d{1,2}\s+\w+\s+\d{4})/i)
            || rawText.match(/Date Posted:\s*(\d{4}-\d{2}-\d{2})/);
          return fallback ? fallback[1].trim() : '';
        },

        jobType: (rawText) => {
          const m = rawText.match(/Role type\s*([^\n]{5,30})/i);
          if (m) return m[1].trim();

          const fallback = rawText.match(/Job Type:\s*(Full-time|Part-time|Contract|Permanent|Internship)/i);
          return fallback ? fallback[1].trim() : '';
        },
      },
    }, (data) => this.createJobData(data));
  }

  getDefaults() {
    return { maxItems: 100, maxPages: 10 };
  }
}