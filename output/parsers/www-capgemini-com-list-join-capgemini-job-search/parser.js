/**
 * Auto-generated parser for www.capgemini.com
 * Generated at: 2026-02-10T07:55:01.327Z
 * Author: AI
 * URL: https://www.capgemini.com/careers/join-capgemini/job-search/?size=15
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';
import { ListCrawler } from '../helpers/ListCrawler.js';

export default class CapgeminiComParser extends BaseParser {
  metadata = {
    name: 'CapgeminiComParser',
    version: '1.0.0',
    domain: 'www.capgemini.com',
    url: 'https://www.capgemini.com/careers/join-capgemini/job-search/',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'Capgemini 列表页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('capgemini.com') && url.includes('job-search');
  }

  async parse(browser, options) {
    return ListCrawler.crawl(browser, options, {
      companyName: 'Capgemini',

      pagination: {
        strategy: 'load-more',
        keywords: ['Load More'],
        waitAfter: 2000,
      },

      descriptionOptions: {
        startMarkers: [
          'Job Description',
          'Funciones y herramientas clave',
          'Responsibilities',
          'Your Role',
          'About the job',
        ],
        endMarkers: [
          'Similar Jobs',
          'Related Jobs',
          'Share this job',
          'Privacy Policy',
          'Cookie Settings',
          'Follow us',
          'Tu carrera en Capgemini',
        ],
      },

      customExtractors: {
        location: (rawText) => {
          // 尝试匹配 "Ubicación: CDMX" 或 "Location: ..."
          const m = rawText.match(/(?:Ubicación|Location):\s*([^\n\r]{1,80})/i);
          if (m) return m[1].trim();
          return '';
        },

        postDate: (rawText) => {
          // Capgemini 页面样本中未明确显示日期，尝试通用匹配
          const m = rawText.match(/Posted:\s*([\d\w\s]{10,30})/i)
            || rawText.match(/Date:\s*([\d\w\s]{10,30})/i);
          return m ? m[1].trim() : '';
        },

        jobType: (rawText) => {
          // 尝试匹配 "Modalidad de trabajo: Hibrido" 或 "Job Type: Permanent"
          const m = rawText.match(/(?:Job Type|Modalidad de trabajo|Employment Type):\s*([^\n\r]{1,40})/i);
          if (m) return m[1].trim();
          return '';
        },
      },
    }, (data) => this.createJobData(data));
  }

  getDefaults() {
    return { maxItems: 100, maxPages: 10 };
  }
}