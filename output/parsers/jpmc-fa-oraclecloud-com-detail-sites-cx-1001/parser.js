/**
 * Auto-generated parser for jpmc.fa.oraclecloud.com
 * Generated at: 2026-02-05T10:00:34.088Z
 * Author: AI (GLM-4.7)
 * URL: https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210690325?keyword=intern
 * Type: detail
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class JpmcfaoraclecloudcomParser extends BaseParser {
  metadata = {
    name: 'Jpmcfaoraclecloudcom',
    version: '1.0.0',
    domain: 'jpmc.fa.oraclecloud.com',
    url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210690325?keyword=intern',
    pageType: 'detail',
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
      // 获取页面快照，设置 maxDepth 为 4 以避免获取过深的底部导航链接
      const { tree, refs } = await browser.getSnapshot({
        interactive: true,
        maxDepth: 4,
      });

      // 判断页面类型：通过 URL 判断是否为详情页
      const currentUrl = await browser.getCurrentUrl();
      const isDetailPage = currentUrl.includes('/job/');

      if (isDetailPage) {
        // 详情页：使用基类方法提取
        // 传入 defaultCompany 以确保公司名称正确
        const job = await this.extractJobFromPage(browser, {
          defaultCompany: 'JPMorgan Chase'
        });
        if (job) {
          jobs.push(job);
        }
      } else {
        // 列表页：查找职位卡片
        // findJobCardRefs 会自动过滤导航链接，且受限于 maxDepth=4，不会抓取底部的推荐职位
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
              defaultCompany: 'JPMorgan Chase'
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