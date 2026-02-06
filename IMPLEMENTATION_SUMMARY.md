# JO Crawler 实现总结

## 项目概述

JO Crawler 是一个基于 Agent-Browser 和 GLM-4.7 LLM 的智能职位爬虫，能够自动生成解析器并爬取招聘网站的职位数据。

## 核心特性

### ✅ 已实现功能

1. **智能解析器生成**
   - 使用 GLM-4.7 LLM 自动分析页面结构
   - 生成 JavaScript 解析器代码
   - 支持列表页和详情页自动识别

2. **完整 JD 提取**
   - 使用 `getPageText()` 获取页面完整文本
   - 智能清理 CSS 和无关内容
   - 保留职位概述、职责、要求、福利等完整信息

3. **动态解析器加载**
   - 无需重启即可加载新解析器
   - 支持热更新和覆盖

4. **Ref 缓存机制**
   - 解决页面跳转后 refs 失效的问题
   - 使用 `saveRefMap()` 保存 refs

5. **两段式 Prompt 架构**
   - 通用 Prompt：BaseParser 和 BrowserService 工具文档
   - 自定义 Prompt：针对每个网站的页面分析

## 架构设计

### 目录结构

```
jo_crawler/
├── src/
│   ├── commands/          # CLI 命令
│   │   ├── generate.ts    # 生成解析器命令
│   │   └── crawl.ts       # 爬取命令
│   ├── models/            # 数据模型
│   │   ├── JobData.ts     # 职位数据模型
│   │   └── CrawlConfig.ts # 爬取配置
│   ├── parsers/           # 解析器
│   │   ├── base/
│   │   │   ├── BaseParser.ts      # 基础解析器
│   │   │   ├── Parser.ts          # 解析器接口
│   │   │   └── GenericParser.ts   # 通用解析器
│   │   ├── generated/             # LLM 生成的解析器
│   │   └── registry.ts            # 解析器注册表
│   ├── prompts/           # Prompt 模板
│   │   └── parser-generator.ts   # 两段式 Prompt
│   ├── services/          # 服务层
│   │   ├── BrowserService.ts      # 浏览器服务
│   │   ├── LLMService.ts          # LLM 服务
│   │   └── JDExtractor.ts         # JD 提取器
│   └── utils/             # 工具函数
│       └── config.ts              # 配置管理
├── output/                # 输出目录
│   └── jobs.json          # 爬取结果
├── links.txt              # 要爬取的 URL
├── .env                   # 环境变量
└── package.json
```

### 核心组件

#### 1. BrowserService
封装 Agent-Browser，提供简化的 API：

```typescript
// 导航和快照
await browser.navigate(url);
const { tree, refs } = await browser.getSnapshot({ interactive: true, maxDepth: 5 });

// 元素操作
await browser.click('@e1');
const text = await browser.getText('@e1');

// Ref 管理
browser.saveRefMap();  // 保存 refs（重要！）

// 页面信息
const url = await browser.getCurrentUrl();
const fullText = await browser.getPageText();  // 获取完整 JD
```

#### 2. BaseParser
提供通用的职位提取方法：

```typescript
// 通用职位提取
const job = await this.extractJobFromPage(browser);

// 查找职位卡片
const jobRefs = this.findJobCardRefs(tree, refs);

// 智能查找标题
const title = this.findTitleInRefs(refs);

// 提取地点
const location = this.extractLocation(text);
```

#### 3. LLMService
调用 GLM-4.7 API：

```typescript
// 生成解析器
const code = await llmService.generateParser(domain, snapshot, url, refMap);

// 分析页面类型
const type = await llmService.analyzePageType(snapshot, url); // 'list' | 'detail'

// 提取职位数据
const data = await llmService.extractJobDataFromSnapshot(snapshot, url);
```

## 使用指南

### 1. 生成解析器

```bash
npm run generate
```

**功能：**
- 读取 `links.txt` 中的 URL
- 分析每个网站的页面结构
- 使用 LLM 生成对应的 JavaScript 解析器
- 保存到 `src/parsers/generated/`

### 2. 爬取职位

```bash
# 默认爬取（每个站点最多 10 个职位）
npm run crawl

# 自定义选项
npm run crawl -- -m 5                    # 每个站点最多 5 个职位
npm run crawl -- -p 2                    # 最大翻页 2 页
npm run crawl -- -f csv                  # 输出 CSV 格式
npm run crawl -- -o data/results.json    # 自定义输出路径
npm run crawl -- --no-headless           # 显示浏览器窗口
```

### 3. 查看结果

```bash
# JSON 格式
cat output/jobs.json | jq '.'

# CSV 格式
cat output/jobs.csv
```

## 输出数据格式

```json
{
  "title": "2027 Markets Summer Analyst Program",
  "company": "JPMorgan Chase",
  "location": "New York, NY",
  "description": "Job Description: If you are ambitious and eager to apply your knowledge...",
  "url": "https://jpmc.fa.oraclecloud.com/...",
  "source": "JpmcFaOraclecloudCom",
  "extractedAt": "2026-02-05T03:56:18.095Z"
}
```

## 性能指标

### Token 使用量

| 项目 | 旧 Prompt | 新 Prompt (两段式) | 减少 |
|------|-----------|-------------------|------|
| System Prompt | ~1200 tokens | ~107 tokens | 91% |
| User Prompt | ~3500 tokens | ~2900 tokens | 17% |
| **总计** | **~4701 tokens** | **~3011 tokens** | **36%** |

### 爬取效率

- 列表页：可同时提取多个职位
- 详情页：直接提取完整 JD
- 平均每个职位：1-2 秒

## 最佳实践

### 1. 优化 Prompt

如果生成的解析器质量不理想，可以：

1. **修改通用 Prompt** ([src/prompts/parser-generator.ts](src/prompts/parser-generator.ts))
   - 添加更多 BaseParser 方法说明
   - 强调特定代码风格

2. **添加自定义规则**
   ```typescript
   function analyzeStructure(snapshot: string, refMap: Record<string, any>): string[] {
     const hints = [];

     // 添加自定义分析规则
     if (snapshot.includes('special-pattern')) {
       hints.push('页面包含特殊结构，需要自定义处理');
     }

     return hints;
   }
   ```

### 2. 扩展 BaseParser

如果需要通用的提取逻辑：

```typescript
// src/parsers/base/BaseParser.ts

protected extractSalary(tree: string): string {
  // 从 tree 中提取薪资信息
  const match = tree.match(/\$\d+,\d+/);
  return match ? match[0] : '';
}
```

### 3. 手动优化解析器

LLM 生成的解析器可以手动优化：

```javascript
// src/parsers/generated/example-com.js

export default class ExampleComParser extends BaseParser {
  async parse(browser, options) {
    // 你的自定义逻辑
    const customJobs = await this.customExtraction(browser);

    // 仍然可以使用 BaseParser 方法
    const baseJobs = await super.parse(browser, options);

    return [...customJobs, ...baseJobs];
  }
}
```

## 故障排除

### 1. 解析器生成失败

**问题：** LLM 返回的代码无法编译

**解决：**
- 检查 GLM API key 是否有效
- 增加 `maxTokens` 配置
- 查看 `src/commands/generate.ts` 中的错误信息

### 2. 爬取时 refs 失效

**问题：** 点击后报错 "Unsupported token @e18"

**解决：**
- 确保在点击前调用 `browser.saveRefMap()`
- 检查解析器代码是否包含 `saveRefMap()` 调用

### 3. JD 不完整

**问题：** 职位描述被截断

**解决：**
- 使用 `getPageText()` 获取完整文本
- 检查 `cleanPageText()` 中的截断逻辑
- 调整 `maxDepth` 参数获取更深层的快照

### 4. Token 不足

**问题：** GLM API 返回 token 超限错误

**解决：**
- 减少快照长度：`snapshot.substring(0, 3000)`
- 减少 `refMap` 中的 refs 数量
- 使用更高效的 prompt（已实现两段式）

## 未来改进

### 短期目标

1. ✅ 支持完整 JD 提取（已完成）
2. ✅ 优化 Prompt 效率（已完成）
3. ⏳ 添加更多数据字段（薪资、部门等）
4. ⏳ 支持分页爬取
5. ⏳ 添加去重功能

### 长期目标

1. 🎯 支持验证码处理
2. 🎯 支持登录后的爬取
3. 🎯 分布式爬取
4. 🎯 实时监控和报警
5. 🎯 数据可视化和分析

## 贡献指南

### 添加新的网站支持

1. 将 URL 添加到 `links.txt`
2. 运行 `npm run generate`
3. 测试生成的解析器
4. 如需优化，手动编辑生成的解析器文件

### 提交代码

1. Fork 项目
2. 创建特性分支
3. 提交变更
4. 发起 Pull Request

## 许可证

MIT License

## 联系方式

- 项目地址: [GitHub](https://github.com/your-repo/jo-crawler)
- 问题反馈: [Issues](https://github.com/your-repo/jo-crawler/issues)

---

**最后更新:** 2026-02-05
