/**
 * Auto-generated parser for td.wd3.myworkdayjobs.com
 * Generated at: 2026-02-05T10:30:00.236Z
 * Author: AI (GLM-4.7)
 * URL: https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers/details/Retail-Market-Manager--US----Lehigh-Montgomery-Regions_R_1456219?locationCountry=bc33aa3152ec42d4995f4791a106ed09&locationCountry=29247e57dbaf46fb855b224e03170bc7&locationCountry=80938777cac5440fab50d729f9634969&locationCountry=a30a87ed25634629aa6c3958aa2b91ea&timeType=14c9322ea8e3014f4096d9d2dc025400
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class Tdwd3myworkdayjobscomParser extends BaseParser {
  metadata = {
    name: 'Tdwd3myworkdayjobscom',
    version: '1.0.0',
    domain: 'td.wd3.myworkdayjobs.com',
    url: 'https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers/details/Retail-Market-Manager--US----Lehigh-Montgomery-Regions_R_1456219?locationCountry=bc33aa3152ec42d4995f4791a106ed09&locationCountry=29247e57dbaf46fb855b224e03170bc7&locationCountry=80938777cac5440fab50d729f9634969&locationCountry=a30a87ed25634629aa6c3958aa2b91ea&timeType=14c9322ea8e3014f4096d9d2dc025400',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'TdWd3MyworkdayjobsCom 职位解析器 - 支持左右分栏列表页提取',
  };

  canParse(_snapshot, url) {
    return url.includes('td.wd3.myworkdayjobs.com');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 10 } = options;

    console.log('🔍 使用 Tdwd3myworkdayjobscom 解析器...');

    try {
      const { tree, refs } = await browser.getSnapshot({
        interactive: true,
        maxDepth: 4,
      });

      // 判断页面类型
      // 根据自定义要求，这是左侧列表、右侧详情的分栏页面，属于列表页逻辑
      const isDetailPage = false;

      if (isDetailPage) {
        // 详情页：使用基类方法提取
        const job = await this.extractJobFromPage(browser);
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

            // 点击左侧列表中的职位，右侧详情会更新
            await browser.click(`@${ref}`);
            // ⚠️ 注意：delay 方法属于 this（解析器实例），不属于 browser
            // 等待右侧详情加载
            await this.delay(1500);

            // 从当前页面（右侧详情）提取职位数据
            const job = await this.extractJobFromPage(browser);
            if (job) {
              jobs.push(job);
            }

            // 由于是左右分栏页面，点击后通常不需要 goBack()
            // 但如果页面发生了跳转，则需要返回
            const currentUrl = await browser.getCurrentUrl();
            const originalUrl = this.metadata.url;
            
            // 简单的 URL 检查，如果 URL 变了（跳转到详情页），则返回
            if (currentUrl !== originalUrl && !currentUrl.includes('?')) {
               await browser的后退();
               await this.delay(1000);
            } else {
               // 如果是分栏刷新，给一个小延迟确保状态稳定
               await this.delay(500);
            }

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