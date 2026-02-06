/**
 * Auto-generated parser for apply.careers.microsoft.com
 * Generated at: 2026-02-05T10:16:12.608Z
 * Author: AI (GLM-4.7)
 * URL: https://apply.careers.microsoft.com/careers?start=0&pid=1970393556749000&sort_by=timestamp
 * Type: detail
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class ApplycareersmicrosoftcomParser extends BaseParser {
  metadata = {
    name: 'Applycareersmicrosoftcom',
    version: '1.0.0',
    domain: 'apply.careers.microsoft.com',
    url: 'https://apply.careers.microsoft.com/careers?start=0&pid=1970393556749000&sort_by=timestamp',
    pageType: 'detail',
    author: 'AI',
    createdAt: new Date(),
    description: 'ApplyCareersMicrosoftCom 职位解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('apply.careers.microsoft.com');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 10 } = options;

    console.log('🔍 使用 Applycareersmicrosoftcom 解析器...');

    try {
      // 获取当前 URL 以准确判断页面类型
      const currentUrl = await browser.getCurrentUrl();
      
      // 判断页面类型：URL 中包含 pid 参数通常表示详情页
      const isDetailPage = currentUrl.includes('pid=');

      if (isDetailPage) {
        // 详情页处理逻辑
        
        // 等待 Job Description 标签加载完毕
        // 根据快照，Job description tab 的 ref 是 @e60
        // 这里我们等待一段时间确保页面完全渲染，特别是动态内容
        await this.delay(2000);

        // 使用基类方法提取职位信息
        const job = await this.extractJobFromPage(browser, {
          defaultCompany: 'Microsoft'
        });
        
        if (job) {
          jobs.push(job);
        }
      } else {
        // 列表页处理逻辑
        
        const { tree, refs } = await browser.getSnapshot({
          interactive: true,
          maxDepth: 4,
        });

        // 查找职位卡片
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

            // 详情页也需要等待 Job Description 加载
            await this.delay(1000);

            const job = await this.extractJobFromPage(browser, {
              defaultCompany: 'Microsoft'
            });
            
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