/**
 * Auto-generated parser for jpmc.fa.oraclecloud.com
 * Generated at: 2026-02-05T10:00:06.520Z
 * Author: AI (GLM-4.7)
 * URL: https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs?keyword=intern
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class JpmcfaoraclecloudcomParser extends BaseParser {
  metadata = {
    name: 'Jpmcfaoraclecloudcom',
    version: '1.0.0',
    domain: 'jpmc.fa.oraclecloud.com',
    url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs?keyword=intern',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'JpmcFaOraclecloudCom 职位解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('jpmc.fa.oraclecloud.com');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 10 } = options;

    console.log('🔍 使用 Jpmcfaoraclecloudcom 解析器...');

    try {
      const { tree, refs } = await browser.getSnapshot({
        interactive: true,
        maxDepth: 4,
      });

      // 判断页面类型
      // 检查 URL 是否包含 jobId 或特定路径，或者检查快照中是否有详情页特征
      const currentUrl = await browser.getCurrentUrl();
      const isDetailPage = currentUrl.includes('/job/') || !refs['@e12'];

      if (isDetailPage) {
        // 详情页：使用基类方法提取
        const job = await this.extractJobFromPage(browser, {
          defaultCompany: 'JPMorgan Chase & Co.'
        });
        if (job) {
          jobs.push(job);
        }
      } else {
        // 列表页：查找职位卡片
        const jobRefs = this.findJobCardRefs(tree, refs);
        console.log(`找到 ${jobRefs.length} 个职位卡片`);

        const limit = Math.min(jobRefs.length, maxItems);

        // 保存当前的 refMap，因为页面跳转后 refs 会失效
        await browser.saveRefMap();

        for (let i = 0; i < limit; i++) {
          const ref = jobRefs[i];

          try {
            console.log(`  [${i + 1}/${limit}] 提取职位 ${ref}...`);

            await browser.click(`@${ref}`);
            await this.delay(1500);

            const job = await this.extractJobFromPage(browser, {
              defaultCompany: 'JPMorgan Chase & Co.'
            });
            if (job) {
              jobs.push(job);
            }

            await browser.goBack();
            await this.delay(1000);
          } catch (error) {
            console.error(`  ❌ 提取失败 (${ref}):`, error.message);
          }
        }
      }
    } catch (error) {
      console.error('❌ 解析失败:', error.message);
    }

    return jobs;
  }

  getDefaults() {
    return {
      maxItems: 10,
      followPagination: false,
      includeDetails: true,
    };
  }
}