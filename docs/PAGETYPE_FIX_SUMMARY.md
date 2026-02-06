# CSV PageType 配置优先级修复

## ✅ 问题描述

**症状：**
- CSV 配置文件中指定 `type=detail`，但生成的解析器 `metadata.pageType` 仍为 `'list'`
- 同一域名的列表页和详情页都被注册为相同类型，导致解析器选择错误

**示例：**
```csv
type,url,max_jobs,prompt
list,https://jpmc.fa.oraclecloud.com/.../jobs?keyword=intern,3,
detail,https://jpmc.fa.oraclecloud.com/.../job/210690325?keyword=intern,1,...
```

期望：
- 列表页 URL → 生成 `pageType: 'list'` 的解析器
- 详情页 URL → 生成 `pageType: 'detail'` 的解析器

实际：
- 列表页 URL → 生成 `pageType: 'list'` ✅
- 详情页 URL → 生成 `pageType: 'list'` ❌（应该是 `'detail'`）

---

## 🔍 根本原因

虽然 `ParserGenerator.ts` 在第 353-355 行正确地从 CSV 配置中读取了 `pageType`：

```typescript
if (configType === 'list' || configType === 'detail') {
  pageType = configType;
  addLog(`📊 页面类型: ${pageType} (CSV配置)`);
}
```

但这个 `pageType` **从未传递给 LLM 生成函数**！

调用链：
```
ParserGenerator.generateForUrlWithConfig()
  └─> const pageType = 'detail'  // ✅ 从 CSV 读取
  └─> llm.generateParser(domain, tree, url, refs, customPrompt)  // ❌ 未传递 pageType
      └─> LLMService.generateParser()
          └─> PARSER_GENERATOR_USER(domain, snapshot, url, refMap)  // ❌ 没有 pageType
              └─> generateCustomPrompt()
                  └─> analyzePageType(snapshot, url)  // ❌ 重新自动分析（失败）
```

结果：
1. CSV 配置被正确读取并显示在日志中
2. 但 LLM 生成代码时调用 `analyzePageType()` 自动检测
3. `analyzePageType()` 无法识别 `/job/210690325` 这种详情页格式
4. 最终生成的解析器 `metadata.pageType = 'list'`（错误）

---

## 🛠️ 修复方案

### 1. 修改 `LLMService.generateParser()` 方法签名

**文件：** `src/services/LLMService.ts`

```diff
  async generateParser(
    domain: string,
    snapshot: string,
    url: string,
    refMap: Record<string, any>,
    customPrompt?: string,
+   pageType?: 'list' | 'detail'  // ✅ 新增：页面类型参数
  ): Promise<{ code: string; usage: any; requestTime: number }> {
-   let userContent = PARSER_GENERATOR_USER(toClassName(domain), snapshot, url, refMap);
+   let userContent = PARSER_GENERATOR_USER(toClassName(domain), snapshot, url, refMap, pageType);
```

### 2. 修改 `PARSER_GENERATOR_USER` 函数

**文件：** `src/prompts/parser-generator.ts`

```diff
  export const PARSER_GENERATOR_USER = (
    domain: string,
    snapshot: string,
    url: string,
    refMap: Record<string, any>,
+   pageType?: 'list' | 'detail'  // ✅ 新增：页面类型参数
  ): string => {
-   return generateCustomPrompt(domain, snapshot, url, refMap);
+   return generateCustomPrompt(domain, snapshot, url, refMap, pageType);
  };
```

### 3. 修改 `generateCustomPrompt` 函数

**文件：** `src/prompts/parser-generator.ts`

```diff
  export const generateCustomPrompt = (
    domain: string,
    snapshot: string,
    url: string,
    refMap: Record<string, any>,
+   providedPageType?: 'list' | 'detail'  // ✅ 新增：外部传入的页面类型
  ): string => {
    // 分析页面类型（如果未提供）
    const analyzedType = analyzePageType(snapshot, url);
+   const finalPageType = providedPageType || analyzedType.type;  // ✅ 优先使用外部传入的

    // ... 后续代码使用 finalPageType
-   **页面类型:** ${pageType.type}
+   **页面类型:** ${finalPageType}

-   pageType: '${pageType.type}',
+   pageType: '${finalPageType}',
```

### 4. 修改 `ParserGenerator.generateForUrlWithConfig()` 调用

**文件：** `src/services/ParserGenerator.ts`

```diff
    const generateResult = await this.llm.generateParser(
      domain,
      tree,
      url,
      refs,
-     customPrompt
+     customPrompt,
+     pageType  // ✅ 传递 pageType
    );
```

### 5. 修复代码模板中的异步调用错误

**文件：** `src/prompts/parser-generator.ts`

```diff
  // 保存当前的 refMap，因为页面跳转后 refs 会失效
-   browser.saveRefMap();
+   await browser.saveRefMap();
```

### 6. 添加变量命名规范

**文件：** `src/prompts/parser-generator.ts`

```diff
  **重要提示:**

  1. **不要重写 BaseParser 的方法** - 直接使用 `this.findJobCardRefs()`, `this.extractJobFromPage()` 等方法即可
  2. **只需要重写必要的方法** - 主要是 `parse()` 方法，根据当前网站特点调整提取逻辑
  3. **refs 参数格式** - `refs` 是一个对象 (Record<string, any>)，不是数组，不要使用 `refs.filter()`
  4. **metadata.domain** - 使用真实的域名（如 'jpmc.fa.oraclecloud.com'），而不是类名格式
+ 5. **⚠️ 变量命名必须准确** - 如果代码框架中定义了 `const isDetailPage = ...`，则后续必须使用 `if (isDetailPage)`，不能简写为 `if (isDetail)`
+ 6. **⚠️ 保持代码框架的变量名** - 不要修改代码框架中已经定义好的变量名
```

### 7. 修复其他 TypeScript 错误

**文件：** `src/commands/generate.ts`

```diff
  if (options.domain) {
-   linkConfigs = linkConfigs.filter(config => config.url.includes(options.domain));
+   linkConfigs = linkConfigs.filter(config => config.url.includes(options.domain!));
```

**文件：** `src/index.ts`

```diff
- import packageJson from '../package.json' assert { type: 'json' };
+ import packageJson from '../package.json';
```

**文件：** `src/utils/parserFilename.ts`

```diff
- for (const type of ['list', 'detail', 'auto']) {
+ for (const type of ['list', 'detail', 'auto'] as const) {
```

---

## ✅ 验证结果

### 1. 构建验证
```bash
npm run build
# ✅ 无 TypeScript 错误
```

### 2. 生成解析器验证
```bash
npm run generate -- --csv --domain jpmc --force
```

**输出：**
```
📊 页面类型: list (CSV配置)  # ✅ 列表页使用 CSV 配置
📊 页面类型: detail (CSV配置)  # ✅ 详情页使用 CSV 配置
```

**生成的解析器元数据：**
```javascript
// 列表页解析器
metadata = {
  pageType: 'list',  // ✅ 正确
}

// 详情页解析器
metadata = {
  pageType: 'detail',  // ✅ 正确
}
```

### 3. 解析器注册验证
```bash
npm run crawl -- --csv
```

**输出：**
```
✅ 已注册解析器: Jpmcfaoraclecloudcom (jpmc.fa.oraclecloud.com - list)
✅ 已注册解析器: Jpmcfaoraclecloudcom (jpmc.fa.oraclecloud.com - detail)
```

✅ 同一域名的列表页和详情页现在分别注册为不同的解析器！

---

## 📊 影响范围

### 修改的文件
1. ✅ `src/services/LLMService.ts` - 添加 `pageType` 参数
2. ✅ `src/prompts/parser-generator.ts` - 使用 `pageType` 参数，增强 Prompt
3. ✅ `src/services/ParserGenerator.ts` - 传递 `pageType` 到 LLM
4. ✅ `src/commands/generate.ts` - 修复 TypeScript 错误
5. ✅ `src/index.ts` - 修复 import 断言错误
6. ✅ `src/utils/parserFilename.ts` - 修复类型断言

### 新增功能
- ✅ CSV 配置的 `pageType` 现在会正确传递给 LLM
- ✅ LLM 生成的解析器会使用 CSV 配置的类型而不是自动检测
- ✅ 增强的 Prompt 模板防止变量命名错误
- ✅ 修复了所有 TypeScript 编译错误

---

## 🔄 优先级逻辑

最终实现的优先级：

1. **CSV 配置** ⭐️⭐️⭐️（最高优先级）
   - 如果 CSV 中指定了 `type=list` 或 `type=detail`，直接使用

2. **LLM 自动分析** ⭐️⭐️（后备方案）
   - 如果 CSV 中未指定或类型无效，调用 `analyzePageType()` 自动检测
   - 用于处理旧的 links.txt 配置文件

3. **默认值** ⭐️（最后兜底）
   - 如果 LLM 返回 `'unknown'`，默认使用 `'list'`

---

## 🎯 总结

### 问题
CSV 配置的 `pageType` 未传递给 LLM，导致生成的解析器类型错误。

### 解决方案
1. 在整个调用链中添加 `pageType` 参数
2. 优先使用 CSV 配置，只有在未提供时才自动检测
3. 增强 Prompt 模板防止常见的 LLM 生成错误

### 结果
✅ CSV 配置现在优先于自动检测
✅ 生成的解析器 `metadata.pageType` 正确反映 CSV 配置
✅ 同一域名的列表页和详情页可以正确注册为不同的解析器

---

**修复日期：** 2026-02-05
**修复状态：** ✅ 完成
**测试状态：** ✅ 通过
