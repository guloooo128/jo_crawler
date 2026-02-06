# 解析器选择问题诊断

## 问题描述

相同域名的详情页和列表页使用了同一个解析器，导致详情页被错误地当作列表页处理。

## 症状

```
🌐 已导航到: https://jpmc.fa.oraclecloud.com/.../jobs/preview/210690325/?keyword=intern
✔ 使用解析器: Jpmcfaoraclecloudcom
📋 检测到列表页，开始查找职位卡片...  # ❌ 应该识别为详情页
```

## 根本原因

### 解析器注册机制

系统使用 `domain::pageType` 作为 key 注册解析器：
- `jpmc.fa.oraclecloud.com::list` → 列表页解析器
- `jpmc.fa.oraclecloud.com::detail` → 详情页解析器

### 解析器选择逻辑

在 `src/parsers/registry.ts:findMatchingParser()` 中：

```typescript
// 如果指定了页面类型，检查是否匹配
if (pageType && parser.metadata.pageType) {
  if (parser.metadata.pageType === pageType) {
    score += 50;  // 页面类型匹配加分
  } else {
    score -= 30;  // 页面类型不匹配减分
  }
}
```

**问题**：只有当 `pageType` 参数被传递时，才会根据 `pageType` 进行加分/减分。

### CSV 配置

```csv
type,url,max_jobs,prompt
detail,https://jpmc.fa.oraclecloud.com/.../jobs/preview/210690325/?keyword=intern,1,...
```

CSV 配置正确指定了 `type=detail`。

### 实际问题

详情页解析器被正确选中了，但**其内部的页面类型判断逻辑**错误地判断当前页面为列表页。

## 诊断步骤

1. **添加调试日志** ✅ 已完成

```javascript
console.log(`🔍 详情页解析器 - 当前URL: ${currentUrl}`);
console.log(`🔍 详情页解析器 - isDetailPage: ${isDetailPage}`);
```

2. **运行测试**
```bash
npm run crawl -- --csv
```

3. **检查日志输出**
- 确认哪个解析器被选中
- 确认 `isDetailPage` 的值
- 确认当前 URL

## 可能的修复方案

### 方案 1: 增强详情页解析器的判断逻辑

```javascript
// 判断页面类型
const isDetailPage =
  currentUrl.includes('/jobs/preview/') ||  // 包含 preview
  /\/jobs\/\d+/.test(currentUrl) ||         // 包含 job ID
  currentUrl.includes('/job/');               // 包含 /job/
```

### 方案 2: 在 crawl.ts 中强制使用 pageType

修改 `src/commands/crawl.ts`，确保即使解析器内部判断失败，也能正确处理：

```typescript
// 如果 CSV 中指定了类型，强制使用该类型的逻辑
if (configType === 'detail') {
  // 直接使用详情页逻辑，不再判断
  const job = await parser.extractJobFromPage(browser, {...});
} else if (configType === 'list') {
  // 使用列表页逻辑
  const jobRefs = parser.findJobCardRefs(tree, refs);
  // ...
}
```

### 方案 3: 修改解析器选择逻辑

确保 `findMatchingParser` 在有 `pageType` 参数时，优先选择匹配的解析器：

```typescript
if (pageType && parser.metadata.pageType === pageType) {
  score += 200;  // 大幅加分，确保选中
}
```

## 下一步

1. 运行测试并收集日志
2. 确认根本原因（是选择问题还是判断逻辑问题）
3. 应用相应的修复方案
4. 重新生成解析器（需要更新 Prompt）

## 相关文件

- `/Users/gollum/Projects/jo_crawler/src/parsers/generated/jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js`
- `/Users/gollum/Projects/jo_crawler/src/parsers/generated/jpmc-fa-oraclecloud-com-list-sites-cx-1001.js`
- `/Users/gollum/Projects/jo_crawler/src/parsers/registry.ts`
- `/Users/gollum/Projects/jo_crawler/src/commands/crawl.ts`
