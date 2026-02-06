/**
 * Auto-generated parser for www.capgemini.com
 * Generated at: 2026-02-06T01:00:57.858Z
 * Author: AI (GLM-4.7)
 * URL: https://www.capgemini.com/careers/join-capgemini/job-search/?size=15
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class WwwcapgeminicomParser extends BaseParser {
  metadata = {
    name: 'Wwwcapgeminicom',
    version: '1.0.0',
    domain: 'www.capgemini.com',
    url: 'https://www.capgemini.com/careers/join-capgemini/job-search/?size=15',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'Wwwcapgeminicom 职位解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('www.capgemini.com') && url.includes('/job-search/');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 10 } = options;

    console.log('🔍 使用 Wwwcapgeminicom 解析器...');

    try {
      // 获取初始快照
      const { tree, refs } = await browser.getSnapshot({
        interactive: true,
        maxDepth: 4,
      });

      // 判断页面类型：通过 URL 判断是否为详情页
      const currentUrl = await browser.getCurrentUrl();
      const isDetailPage = !currentUrl.includes('/job-search/');

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

        let limit = Math.min(jobRefs.length, maxItems);
        let currentIndex = 0;

        // 保存当前的 refMap，因为页面跳转后 refs 会失效
        await browser.saveRefMap();

        // 循环提取职位，直到达到 maxItems 或没有更多职位
        while (currentIndex < limit && jobs.length < maxItems) {
          const ref = jobRefs[currentIndex];

          try {
            console.log(`  [${jobs.length + 1}/${maxItems}] 提取职位 ${ref}...`);

            await browser.click(`@${ref}`);
            // ⚠️ 注意：delay 方法属于 this（解析器实例），不属于 browser
            await this.delay(1500);

            const job = await this.extractJobFromPage(browser);
            if (job) {
              jobs.push(job);
            }

            await browser.goBack();
            // ⚠️ 注意：使用 this.delay()，不要使用 browser.delay()
            await this.delay(1000);
          } catch (error) {
            console.error(`  ❌ 提取失败 (${ref}):`, error.message);
          }

          currentIndex++;

          // 如果已提取当前页所有职位，但总数未达 maxItems，尝试加载更多
          if (currentIndex >= jobRefs.length && jobs.length < maxItems) {
            console.log('当前页职位已提取完，尝试加载更多...');
            const loaded = await this.loadMoreJobs(browser);
            if (loaded) {
              // 重新获取快照和 refs
              const newSnapshot = await browser.getSnapshot({
                interactive: true,
                maxDepth: 4,
              });
              // 将新找到的 refs 添加到 jobRefs 数组中
              const newRefs = this.findJobCardRefs(newSnapshot.tree, newSnapshot.refs);
              // 过滤掉已经处理过的 refs (简单起见，这里假设新加载的都是新的)
              // 实际场景可能需要更复杂的去重逻辑，这里追加即可
              jobRefs.push(...newRefs);
              
              // 更新 limit
              limit = Math.min(jobRefs.length, maxItems);
              
              // 保存新的 refMap
              await browser.saveRefMap();
            } else {
              console.log('没有更多职位可加载');
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ 解析失败:', error.message);
    }

    return jobs;
  }

  /**
   * 尝试点击 "Load More" 按钮加载更多职位
   * @param {BrowserService} browser 
   * @returns {Promise<boolean>} 是否成功加载
   */
  async loadMoreJobs(browser) {
    try {
      const { refs } = await browser.getSnapshot({ interactive: true, maxDepth: 3 });
      
      // 查找包含 "Load" 或 "More" 文本的按钮
      const loadMoreRef = Object.keys(refs).find(key => {
        const item = refs[key];
        return (item.role === 'button' || item.tagName === 'button') && 
               (item.name?.toLowerCase().includes('load') || item.name?.toLowerCase().includes('more'));
      });

      if (loadMoreRef) {
        console.log(`找到加载更多按钮: @${loadMoreRef}`);
        await browser.click(`@${loadMoreRef}`);
        await this.delay(2000); // 等待内容加载
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('加载更多失败:', error.message);
      return false;
    }
  }

  getDefaults() {
    return {
      maxItems: 10,
      followPagination: false,
      includeDetails: true,
    };
  }
}