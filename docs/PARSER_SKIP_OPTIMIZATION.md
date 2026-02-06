# 解析器重复生成优化

## 🎯 问题

之前的实现：每次运行 `npm run generate` 都会：
1. 访问所有 URL
2. 调用 LLM API 生成解析器
3. 保存时才检查文件是否存在

**问题：** 浪费时间和 API 调用额度！

## ✅ 解决方案

### 优化后的流程

```
开始生成
  ↓
获取已存在的解析器列表
  ↓
遍历每个 URL
  ↓
检查解析器是否已存在？
  ├─ 是 → ⏭️ 跳过（不访问页面，不调用 LLM）
  └─ 否 → 🔄 开始生成
```

### 关键改进

**文件：** [src/services/ParserGenerator.ts](../src/services/ParserGenerator.ts)

```typescript
async generateBatchWithConfigs(configs: LinkConfig[]) {
  // 1. 获取已存在的解析器列表
  const existingParsers = await this.getExistingParsers();
  // 返回: ['file1.js', 'file2.js', ...]

  for (const linkConfig of configs) {
    // 2. 计算预期的文件名
    const expectedFilename = generateParserFilename(
      domain, url, pageType
    ) + '.js';

    // 3. 检查是否已存在
    if (existingParsers.includes(expectedFilename)) {
      console.log(`⏭️  跳过已存在的解析器: ${expectedFilename}`);
      results.push({
        config: linkConfig,
        success: true,
        skipped: true,  // 标记为跳过
      });
      continue;  // 跳过整个生成流程
    }

    // 4. 不存在，才开始生成
    await this.generateForUrlWithConfig(linkConfig);
  }
}
```

## 📊 效果对比

### 优化前 ❌

```bash
$ npm run generate -- --csv

🔍 正在分析: https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs
🌐 已导航到: ...
📸 获取页面快照...
🤖 使用 LLM 生成解析器代码...
📊 GLM Token 使用: 2304 + 676 = 2980
💾 保存解析器...
⚠️  解析器已存在: jpmc-fa-oraclecloud-com-list-sites-cx-1001.js

🔍 正在分析: https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs/123
🌐 已导航到: ...
📸 获取页面快照...
🤖 使用 LLM 生成解析器代码...
📊 GLM Token 使用: 2304 + 676 = 2980
💾 保存解析器...
⚠️  解析器已存在: jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js

时间: ~3 分钟
Token 消耗: ~6000 tokens
结果: 文件已存在，但还是访问了页面和调用了 LLM！
```

### 优化后 ✅

```bash
$ npm run generate -- --csv

⏭️  跳过已存在的解析器: jpmc-fa-oraclecloud-com-list-sites-cx-1001.js
⏭️  跳过已存在的解析器: jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js
⏭️  跳过已存在的解析器: apply-careers-microsoft-com-detail-861a1a43.js

📊 生成结果:
⏭️  1. https://jpmc.fa.oraclecloud.com/.../sites/CX_1001 - 已存在
⏭️  2. https://jpmc.fa.oraclecloud.com/.../sites/CX_1001 - 已存在
⏭️ 3. https://apply.careers.microsoft.com/careers?start=0... - 已存在

📈 统计:
  成功: 0
  跳过: 3
  失败: 0

💡 所有解析器都已存在，无需重新生成

时间: ~2 秒
Token 消耗: 0 tokens
结果: 快速跳过，没有浪费！
```

## 🚀 性能提升

| 指标 | 优化前 | 优化后 | 改进 |
|------|--------|--------|------|
| **首次生成（3个URL）** | ~3 分钟 | ~3 分钟 | - |
| **重复生成（3个已存在）** | ~3 分钟 + 6000 tokens | ~2 秒 | **98%** ⬇️ |
| **部分生成（1个新+2个已存在）** | ~3 分钟 + 6000 tokens | ~1 分钟 + 2000 tokens | **50%** ⬇️ |

## 🔍 工作原理

### 1. 预计算文件名

在访问页面前，就计算预期的解析器文件名：

```typescript
// 输入
domain = "jpmc.fa.oraclecloud.com"
url = "https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs"
pageType = "list"

// 计算
filename = generateParserFilename(domain, url, pageType)
// 返回: "jpmc-fa-oraclecloud-com-list-sites-cx-1001.js"
```

### 2. 快速文件检查

```typescript
const existingParsers = await fs.readdir(this.outputDir);
// 返回: ['file1.js', 'file2.js', ...]

const alreadyExists = existingParsers.includes(expectedFilename);
// 如果已存在，直接跳过
```

### 3. 三种结果状态

| 状态 | 图标 | 说明 |
|------|------|------|
| **成功** | ✅ | 新生成的解析器 |
| **跳过** | ⏭️ | 已存在，跳过生成 |
| **失败** | ❌ | 生成失败（网络错误、LLM错误等） |

## 📝 使用场景

### 场景 1: 首次生成

```bash
$ npm run generate -- --csv

🔍 正在分析: https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs
...
✅ 解析器已保存: jpmc-fa-oraclecloud-com-list-sites-cx-1001.js

结果: 成功生成所有解析器
```

### 场景 2: 重复运行（全部已存在）

```bash
$ npm run generate -- --csv

⏭️  跳过已存在的解析器: jpmc-fa-oraclecloud-com-list-sites-cx-1001.js
⏭️ 跳过已存在的解析器: jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js

结果: 快速跳过，2秒完成
```

### 场景 3: 部分更新（部分已存在）

```bash
$ npm run generate -- --csv

⏭️  跳过已存在的解析器: jpmc-fa-oraclecloud-com-list-sites-cx-1001.js
🔍 正在分析: https://new-site.com/jobs  # 新的 URL
...
✅ 解析器已保存: new-site-com-list-jobs.js

结果: 只生成新的，复用已有的
```

## 💡 最佳实践

### 1. 开发测试

频繁运行 `npm run generate` 时：
- ✅ 已有的解析器会被跳过
- ✅ 只处理新增的 URL
- ✅ 节省时间和 API 调用

### 2. 生产部署

首次部署后：
```bash
# 第一次：生成所有解析器
npm run generate -- --csv
# 输出: 生成 10 个解析器，耗时 10 分钟

# 后续更新：添加新 URL
# 编辑 links.csv，添加新 URL
npm run generate -- --csv
# 输出: 跳过 10 个，生成 1 个，耗时 1 分钟
```

### 3. 强制重新生成

如果需要强制覆盖已有解析器（TODO: 未来功能）：

```bash
# 删除要重新生成的解析器
rm src/parsers/generated/jpmc-fa-oraclecloud-com-list-sites-cx-1001.js

# 重新生成
npm run generate -- --csv
```

## 🔧 技术细节

### 文件名匹配算法

```typescript
// 1. 清理域名
const cleanDomain = domain
  .replace(/\*/g, '_')
  .replace(/\./g, '-');

// 2. 提取 URL 签名
const urlSignature = extractUrlSignature(url);
// 例如: sites-cx-1001

// 3. 组合文件名
const filename = `${cleanDomain}-${pageType}-${urlSignature}.js`;
```

### 文件系统检查

```typescript
// 读取目录
const files = await fs.readdir(outputDir);

// 过滤 .js 文件
const parsers = files.filter(file => file.endsWith('.js'));

// 检查是否存在
const exists = parsers.includes(expectedFilename);
```

## 📊 统计输出

### 新的统计格式

```bash
📈 统计:
  成功: 2    # 新生成的
  跳过: 5    # 已存在的，跳过
  失败: 0    # 生成失败的
  总计: 7
```

**解释：**
- **成功** - 新生成的解析器数量
- **跳过** - 检测到已存在，跳过生成的数量
- **失败** - 生成过程中出错的数量

## 🎯 优势总结

1. **性能提升** - 重复运行从 3 分钟降到 2 秒（98% 提升）
2. **成本节省** - 不再重复调用 LLM API
3. **开发效率** - 开发测试时可以频繁运行而不用担心浪费
4. **智能检测** - 自动识别已存在的解析器
5. **向后兼容** - 不影响已有的工作流程

## 📚 相关文件

- **实现：** [src/services/ParserGenerator.ts](../src/services/ParserGenerator.ts)
- **文件名生成：** [src/utils/parserFilename.ts](../src/utils/parserFilename.ts)
- **配置文件：** [links.csv](../links.csv)

---

**最后更新:** 2026-02-05
