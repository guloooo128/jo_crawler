/**
 * Auto-generated parser for td.wd3.myworkdayjobs.com
 * Generated at: 2026-02-05T10:23:01.710Z
 * Author: AI (GLM-4.7)
 * URL: https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers/details/Retail-Market-Manager--US----Lehigh-Montgomery-Regions_R_1456219?locationCountry=bc33aa3152ec42d4995f4791a106ed09&locationCountry=29247e57dbaf46fb855b224e03170bc7&locationCountry=80938777cac5440fab50d729f9634969&locationCountry=a30a87ed25634629aa6c3958aa2b91ea&timeType=14c9322ea8e3014f4096d9d2dc025400
 * Type: detail
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class Tdwd3myworkdayjobscomParser extends BaseParser {
  metadata = {
    name: 'Tdwd3myworkdayjobscom',
    version: '1.0.0',
    domain: 'td.wd3.myworkdayjobs.com',
    url: 'https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers/details/Retail-Market-Manager--US----Lehigh-Montgomery-Regions_R_1456219',
    pageType: 'detail',
    author: 'AI',
    createdAt: new Date(),
    description: 'TdWd3MyworkdayjobsCom 职位解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('td.wd3.myworkdayjobs.com');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 10 } = options;

    console.log('🔍 使用 Tdwd3myworkdayjobscom 解析器...');

    try {
      // 获取当前 URL 以准确判断页面类型
      const currentUrl = await browser.getCurrentUrl();
      
      const { tree, refs } = await browser.getSnapshot({
        interactive: true,
        maxDepth: 4,
      });

      // 判断页面类型：URL 中包含 /details/ 视为详情页
      const isDetailPage = currentUrl.includes('/details/');

      if (isDetailPage) {
        // 详情页：使用基类方法提取
        // 传入默认公司名称 "TD Bank"
        const job = await this.extractJobFromPage(browser, { defaultCompany: 'TD Bank' });
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
            // ⚠️ 注意：delay 方法属于 this（解析器实例），不属于 browser
            await this.delay(1500);

            const job = await this.extractJobFromPage(browser, { defaultCompany: 'TD Bank' });
            if (job) {
              jobs.push(job);
            }

            await browser.goBack();
            // ⚠️ 注意：使用 this.delay()，不要使用 browser.delay()
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