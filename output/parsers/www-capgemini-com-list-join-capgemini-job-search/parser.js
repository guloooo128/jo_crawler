/**
 * Auto-generated parser for www.capgemini.com
 * Generated at: 2026-02-09T03:04:18.503Z
 * Author: AI (GLM-4.7)
 * URL: https://www.capgemini.com/careers/join-capgemini/job-search/?size=15
 * Type: list
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

import { BaseParser } from '../base/BaseParser.js';

export default class WwwCapgeminiComParser extends BaseParser {
  metadata = {
    name: 'WwwCapgeminiCom',
    version: '1.0.0',
    domain: 'www.capgemini.com',
    url: 'https://www.capgemini.com/careers/join-capgemini/job-search/?size=15',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'www.capgemini.com list 页面职位解析器',
  };

  // 重写公司名称
  getCompanyName() {
    return 'Capgemini';
  }

  canParse(_snapshot, url) {
    return url.includes('www.capgemini.com');
  }

  /**
   * 解析职位链接的 name 属性，提取元数据
   * 示例: "Senior ASIC Verification Engineer Greece Ampelokipoi, Athens, Thessaloniki/Steliou Kazantzidi Experienced Professionals Permanent"
   * 结构推断: [Title] [Country] [Location] [Level] [Type]
   */
  parseJobLinkName(name) {
    const parts = name.split(' ');
    
    // 常见的职位类型关键词
    const jobTypes = ['Permanent', 'Contract', 'Internship', 'Temporary', 'Part-time', 'Full-time'];
    // 常见的级别关键词
    const levels = ['Experienced', 'Professionals', 'Graduate', 'Intern', 'Student', 'Junior', 'Senior', 'Lead', 'Manager', 'Director'];
    
    let jobType = '';
    let level = '';
    let country = '';
    let location = '';
    let title = '';

    // 1. 提取 Job Type (通常在最后)
    const lastPart = parts[parts.length - 1];
    if (jobTypes.includes(lastPart)) {
      jobType = lastPart;
      parts.pop(); // 移除 type
    }

    // 2. 提取 Level (通常在 type 之前，可能是 "Experienced Professionals" 这种组合)
    // 检查最后两个词是否组成 Level
    const lastTwo = parts.slice(-2).join(' ');
    if (levels.some(l => lastTwo.includes(l))) {
      level = lastTwo;
      parts.pop();
      parts.pop();
    } else {
      // 检查最后一个词
      const lastOne = parts[parts.length - 1];
      if (levels.some(l => lastOne.includes(l))) {
        level = lastOne;
        parts.pop();
      }
    }

    // 3. 提取 Country (通常在 Title 之后，Location 之前)
    // 剩余部分的开头是 Title，结尾是 Location/Address
    // 尝试识别国家名（简单策略：首字母大写的单词，通常在位置较前的位置）
    // 对于 Capgemini，国家通常紧跟在 Title 后面
    // 假设 Title 至少包含 3 个单词，Country 是第 4 个单词之后
    
    // 重新组合剩余部分用于分割
    const remainingText = parts.join(' ');
    
    // 尝试通过已知国家列表匹配（这里简化处理，取 Title 后的第一个大写单词作为 Country）
    // 实际上，Location 往往包含城市和具体地址，比较复杂
    // 我们可以尝试把剩余部分倒序解析，Location 通常包含逗号或斜杠
    
    // 简化策略：
    // 剩余部分: "Title ... Country Location"
    // 我们可以尝试把 Location (包含逗号/斜杠的部分) 剥离出来
    
    const locationMatch = remainingText.match(/(.*?)([A-Z][^,]*,\s*[^,]*|[^,]*\/[^\/]*)$/);
    if (locationMatch) {
      // locationMatch[1] 可能是 Title + Country
      // locationMatch[2] 是 Location
      location = locationMatch[2].trim();
      const titleAndCountry = locationMatch[1].trim();
      
      // 尝试分离 Title 和 Country
      const titleParts = titleAndCountry.split(' ');
      if (titleParts.length > 1) {
        country = titleParts[titleParts.length - 1];
        title = titleParts.slice(0, titleParts.length - 1).join(' ');
      } else {
        title = titleAndCountry;
      }
    } else {
      title = remainingText;
    }

    return {
      title: this.cleanText(title),
      country: this.cleanText(country),
      location: this.cleanText(location),
      level: this.cleanText(level),
      jobType: this.cleanText(jobType)
    };
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 10 } = options;

    console.log('🔍 使用 WwwCapgeminiCom 解析器...');

    try {
      // 第一步：在列表页收集所有职位 URL
      const { tree, refs } = await browser.getSnapshot({ interactive: true, maxDepth: 5 });
      
      // 过滤出职位链接 refs
      // 特征：name 包含多个单词，且包含 "Experienced" 或 "Permanent" 等关键词，且不是页脚链接
      const jobRefs = Object.entries(refs).filter(([key, ref]) => {
        if (!ref.name) return false;
        // 排除导航和页脚链接
        const navKeywords = ['Skip', 'Contact', 'Investors', 'Facebook', 'Linkedin', 'Youtube', 'Instagram', 'Capgemini', 'Insights', 'Industries', 'Services', 'Careers', 'News', 'About', 'Accessibility', 'Cookie', 'Privacy', 'Security', 'SpeakUp', 'Terms', 'Fraud', 'Glassdoor'];
        if (navKeywords.some(k => ref.name.includes(k))) return false;
        
        // 职位链接通常包含国家名或职位类型关键词
        const jobKeywords = ['Experienced', 'Professionais', 'Permanent', 'Contract', 'Greece', 'Brazil', 'Netherlands', 'Ukraine'];
        // 且长度较长（包含 Title + Location + Type）
        return ref.name.split(' ').length > 5 && jobKeywords.some(k => ref.name.includes(k));
      });

      console.log(`🔍 找到 ${jobRefs.length} 个职位候选链接`);

      // 【核心】使用 collectJobLinks 一次性收集所有 URL
      const jobLinks = await this.collectJobLinks(browser, jobRefs);
      console.log(`✅ 成功收集 ${jobLinks.length} 个职位 URL`);

      // 保存列表页 URL（分页时需要返回）
      const listUrl = await browser.getCurrentUrl();

      // 第二步：逐个导航到详情页提取数据
      for (const link of jobLinks.slice(0, maxItems)) {
        try {
          // 解析 link.name 中能得到的字段
          const listMeta = this.parseJobLinkName(link.name);
          
          console.log(`🚀 正在处理职位: ${listMeta.title}`);
          
          // 直接导航到详情页（不要用 click）
          await browser.navigate(link.url);
          await this.delay(2000); // 等待待页面加载

          // 使用内置方法提取详情页所有字段
          const detail = await this.extractDetailFields(browser);

          // 合并列表页和详情页数据
          // 优先使用列表页解析出的 location 和 type，因为详情页可能格式不统一
          const jobData = this.createJobData({
            job_title: listMeta.title || detail.job_title,
            company_name: this.getCompanyName(),
            location: listMeta.location || detail.location,
            job_link: link.url,
            post_date: detail.post_date,
            dead_line: detail.dead_line,
            job_type: listMeta.jobType || detail.job_type,
            description: detail.description,
            salary: detail.salary,
            source: this.getCompanyName(),
          });
          
          jobs.push(jobData);
        } catch (err) {
          console.error(`❌ 提取职位失败 (${link.url}):`, err.message);
        }
      }

      // 第三步：分页处理（点击 Load More）
      // 如果需要加载更多，可以在这里实现逻辑
      // 注意：这里只是示例，实际需要根据需求决定是否循环加载
      if (options.followPagination && jobLinks.length >= maxItems) {
        console.log('🔄 尝试加载更多职位...');
        await browser.navigate(listUrl);
        await this.delay(2000);
        
        // 获取新的快照以找到 Load More 按钮
        const { refs: newRefs } = await browser.getSnapshot({ interactive: true, maxDepth: 5 });
        const loadMoreRef = Object.entries(newRefs).find(([key, ref]) => 
          ref.name && ref.name.includes('Load More')
        );

        if (loadMoreRef) {
          console.log('🖱️ 点击 Load More 按钮...');
          await browser.click(loadMoreRef[0]);
          await this.delay(3000); // 等待加载
          // 递归调用 parse 或继续收集逻辑...
          // 为防止无限循环，实际生产中需要控制深度
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