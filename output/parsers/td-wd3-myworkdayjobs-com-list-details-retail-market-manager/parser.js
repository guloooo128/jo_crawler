/**
 * Auto-generated parser for td.wd3.myworkdayjobs.com
 * Generated at: 2026-02-09T03:24:31.606Z
 * Author: AI (GLM-4.7)
 * URL: https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers/details/Retail-Market-Manager--US----Lehigh-Montgomery-Regions_R_1456219?locationCountry=bc33aa3152ec42d4995f4791a106ed09&locationCountry=29247e57dbaf46fb855b224e03170bc7&locationCountry=80938777cac5440fab50d729f9634969&locationCountry=a30a87ed25634629aa6c3958aa2b91ea&timeType=14c9322ea8e3014f4096d9d2dc025400
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class TdWd3MyworkdayjobsComParser extends BaseParser {
  metadata = {
    name: 'TdWd3MyworkdayjobsCom',
    version: '1.0.0',
    domain: 'td.wd3.myworkdayjobs.com',
    url: 'https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers/details/Retail-Market-Manager--US----Lehigh-Montgomery-Regions_R_1456219?locationCountry=bc33aa3152ec42d4995f4791a106ed09&locationCountry=29247e57dbaf46fb855b224e03170bc7&locationCountry=80938777cac5440fab50d729f9634969&locationCountry=a30a87ed25634629aa6c3958aa2b91ea&timeType=14c9322ea8e3014f4096d9d2dc025400',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'td.wd3.myworkdayjobs.com list 页面职位解析器',
  };

  // 重写公司名称
  getCompanyName() {
    return 'TD Bank';
  }

  canParse(_snapshot, url) {
    return url.includes('td.wd3.myworkdayjobs.com');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 10 } = options;

    console.log('🔍 使用 TdWd3MyworkdayjobsCom 解析器...');

    try {
      // 获取当前页面快照
      const { tree, refs } = await browser.getSnapshot({ interactive: true, maxDepth: 5 });

      // --- 第一步：识别并过滤职位链接 Refs ---
      // 根据快照分析，职位链接是 link 类型，且 name 较长（包含多个单词）
      // 排除页脚、导航、分页等短链接
      const jobRefEntries = Object.entries(refs).filter(([key, ref]) => {
        // 必须是 link 类型
        if (ref.role !== 'link') return false;
        
        // 排除已知的非职位链接（根据快照中的 ref=e1, e5, e51, e52, e53 等）
        const name = ref.name || '';
        const skipKeywords = [
          'Skip to', 'careers home', 'LinkedIn', 'Facebook', 'Privacy Policy', 
          'page', 'next', 'previous', 'Sign In', 'Why Choose Us'
        ];
        
        // 如果包含跳过关键词，则忽略
        if (skipKeywords.some(keyword => name.toLowerCase().includes(keyword.toLowerCase()))) {
          return false;
        }

        // 职位标题通常较长（> 15个字符）且包含空格或特定标点
        // 示例: "Bilingual Contact Center Representative, Canadian Banking, Easyline"
        if (name.length < 15) return false;

        return true;
      });

      console.log(`🔎 找到 ${jobRefEntries.length} 个职位链接候选`);

      // --- 第二步：收集所有职位 URL ---
      // 使用 collectJobLinks 一次性获取所有链接的详细信息
      const jobLinks = await this.collectJobLinks(browser, jobRefEntries);
      console.log(`✅ 成功收集 ${jobLinks.length} 个职位 URL`);

      // 保存当前列表页 URL，以便后续分页或重置
      const listUrl = await browser.getCurrentUrl();

      // --- 第三步：遍历链接并提取详情 ---
      // 限制处理数量，防止运行时间过长
      const linksToProcess = jobLinks.slice(0, maxItems);

      for (let i = 0; i < linksToProcess.length; i++) {
        const link = linksToProcess[i];
        console.log(`📄 处理第 ${i + 1}/${linksToProcess.length} 个职位: ${link.name}`);

        try {
          // 从列表页的 link name 中解析部分元数据
          // 结构分析: "Title - Location - Department (Type)" 或 "Title, Department, Location"
          // 策略：尝试提取 Title（第一部分）和 Location（通常在 - 或 , 之后）
          const parsedInfo = this.parseJobTitleFromName(link.name);

          // 直接导航到详情页 URL（避免 click 导致的 ref 失效问题）
          await browser.navigate(link.url);
          await this.delay(1500); // 等待页面加载

          // 使用内置方法提取详情页所有字段（自动去噪）
          const detail = await this.extractDetailFields(browser);

          // 合并数据
          const jobData = this.createJobData({
            job_title: parsedInfo.title || detail.job_title,
            company_name: this.getCompanyName(),
            location: parsedInfo.location || detail.location,
            job_link: link.url,
            post_date: detail.post_date,
            dead_line: detail.dead_line,
            job_type: parsedInfo.type || detail.job_type,
            description: detail.description,
            salary: detail.salary,
            source: this.getCompanyName(),
          });

          jobs.push(jobData);

          // 如果不是最后一个，导航回列表页准备下一次跳转（虽然 navigate 直接跳转不需要 goBack，但保持状态清晰）
          // 注意：由于我们使用的是 navigate(url)，浏览器状态是独立的，不需要显式 goBack
          // 但为了保险起见，如果页面有状态残留，可以刷新或返回列表
          if (i < linksToProcess.length - 1) {
             await browser.navigate(listUrl);
             await this.delay(1000);
          }

        } catch (err) {
          console.error(`❌ 提取职位失败 (${link.name}):`, err.message);
          // 发生错误时，确保回到列表页
          await browser.navigate(listUrl);
          await this.delay(1000);
        }
      }

      // --- 第四步：分页处理（可选）---
      // 如果需要处理分页，可以在这里点击 "next" 按钮 (ref=e48)
      // 注意：这通常需要重新获取快照，因为 DOM 可能已变化
      // if (options.followPagination && jobs.length < maxItems) { ... }

    } catch (error) {
      console.error('❌ 解析过程严重错误:', error.message);
    }

    return jobs;
  }

  /**
   * 辅助方法：从列表页的 Link Name 中解析职位信息
   * 示例:
   * 1. "Bilingual Contact Center Representative, Canadian Banking, Easyline"
   * 2. "Market President - South Carolina - Commercial (US)"
   * 3. "Financial Advisor - Long Island - Multiple Opportunities Available"
   */
  parseJobTitleFromName(name) {
    let title = name;
    let location = '';
    let type = '';

    // 尝试按 " - " 分割（常见于 Location 分隔）
    const parts = name.split(' - ');
    
    if (parts.length > 1) {
      title = parts[0].trim();
      // 最后一部分可能包含类型信息，如 "(US)" 或 "Full Time"
      const lastPart = parts[parts.length - 1].trim();
      
      // 简单的启发式判断：如果最后一部分包含括号，可能是类型或国家
      if (lastPart.includes('(') && lastPart.includes(')')) {
        type = lastPart;
        // 倒数第二部分可能是地点
        if (parts.length > 2) {
          location = parts[parts.length - 2].trim();
        }
      } else {
        // 否则假设最后一部分是地点
        location = lastPart;
      }
    } else {
      // 尝试按 ", " 分割（常见于 Department 分隔）
      const commaParts = name.split(', ');
      if (commaParts.length > 1) {
        title = commaParts[0].trim();
        // 最后一部分通常是地点或部门
        location = commaParts[commaParts.length - 1].trim();
      }
    }

    // 清理 title 中可能残留的部门信息（如果太长）
    // 这里仅做简单截断，实际提取以详情页为准
    if (title.length > 100) {
      title = title.substring(0, 100);
    }

    return { title, location, type };
  }

  getDefaults() {
    return {
      maxItems: 10,
      followPagination: false,
      includeDetails: true,
    };
  }
}