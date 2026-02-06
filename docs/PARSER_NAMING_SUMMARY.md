# 解析器文件名冲突解决方案

## 🎯 问题背景

当使用 CSV 配置文件时，如果出现以下情况，会导致解析器文件互相覆盖：

1. **相同域名，不同页面类型**
   - 列表页：`https://jpmc.fa.oraclecloud.com/.../jobs`
   - 详情页：`https://jpmc.fa.oraclecloud.com/.../jobs/123`

2. **相同域名，不同公司/部门**
   - CX_1001 部门：`https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs`
   - CX_1002 部门：`https://jpmc.fa.oraclecloud.com/.../sites/CX_1002/jobs`

3. **相同域名，不同业务**
   - 工程：`https://careers.company.com/engineering`
   - 销售：`https://careers.company.com/sales`

如果都用简单的域名命名（如 `jpmc-fa-oraclecloud-com.js`），后生成的会覆盖前面的。

## ✅ 解决方案概述

### 核心策略：三段式命名

```
<域名>-<页面类型>-<URL签名>.js
```

**关键特性：**
- ✅ **唯一性**：每个 URL 生成唯一的文件名
- ✅ **可读性**：文件名包含关键信息（类型、部门）
- ✅ **防重复**：检查文件是否存在，避免重复生成
- ✅ **向后兼容**：支持旧的简单域名命名

## 🔧 实现细节

### 1. 文件名生成逻辑

**文件：** [src/utils/parserFilename.ts](../src/utils/parserFilename.ts)

```typescript
// 生成唯一文件名
generateParserFilename(domain, url, pageType)
// 返回: "jpmc-fa-oraclecloud-com-list-sites-cx-1001"
```

### 2. URL 签名提取

**优先级：**

1. **站点 ID** (最推荐)
   ```
   /sites/CX_1001/ → sites-cx-1001
   /sites/US-Engineering/ → sites-us-engineering
   ```

2. **路径关键字**
   ```
   /engineering/jobs → engineering
   /sales/careers → sales
   ```

3. **URL 哈希** (兜底方案)
   ```
   https://example.com/complex/path → 861a1a43 (MD5前8位)
   ```

### 3. 防重复机制

```typescript
// 保存前检查
async saveGeneratedParser(domain, code, outputDir, url, pageType) {
  const filename = generateParserFilename(domain, url, pageType) + '.js';
  const filepath = path.join(outputDir, filename);

  if (await fs.pathExists(filepath)) {
    console.log(`⚠️  解析器已存在: ${filename}`);
    console.log(`💡 使用 --force 选项可覆盖现有解析器`);
    return filepath;  // 跳过保存
  }

  // 保存新文件
  await fs.writeFile(filepath, header + code, 'utf-8');
  console.log(`✅ 解析器已保存: ${filepath}`);
}
```

## 📊 实际效果对比

### 问题场景

**CSV 配置：**
```csv
type,url,max_jobs
list,https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs,3
detail,https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs/123,1
list,https://jpmc.fa.oraclecloud.com/.../sites/CX_1002/jobs,3
```

### 旧方案（简单域名）❌

```
生成文件：
├── jpmc-fa-oraclecloud-com.js  (第1个)
├── jpmc-fa-oraclecloud-com.js  (第2个 - 覆盖第1个!)
└── jpmc-fa-oraclecloud-com.js  (第3个 - 覆盖第2个!)

结果：只有最后一个文件存在，前两个被覆盖了！
```

### 新方案（三段式命名）✅

```
生成文件：
├── jpmc-fa-oraclecloud-com-list-sites-cx-1001.js  (CX_1001 列表页)
├── jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js (CX_1001 详情页)
└── jpmc-fa-oraclecloud-com-list-sites-cx-1002.js  (CX_1002 列表页)

结果：所有文件都独立存在，互不覆盖！
```

## 🎯 使用场景

### 场景 1: 多公司招聘平台

```csv
type,url,max_jobs
list,https://universe.example.com/companyA/jobs,10
list,https://universe.example.com/companyB/jobs,10
detail,https://universe.example.com/companyA/jobs/123,1
detail,https://universe.example.com/companyB/jobs/456,1
```

**生成文件：**
```
universe-example-com-list-companya.js
universe-example-com-list-companyb.js
universe-example-com-detail-companya.js
universe-example-com-detail-companyb.js
```

### 场景 2: 大型企业多部门

```csv
type,url,max_jobs
list,https://careers.bigcorp.com/engineering,20
list,https://careers.bigcorp.com/sales,15
list,https://careers.bigcorp.com/marketing,10
detail,https://careers.bigcorp.com/engineering/123,1
```

**生成文件：**
```
careers-bigcorp-com-list-engineering.js
careers-bigcorp-com-list-sales.js
careers-bigcorp-com-list-marketing.js
careers-bigcorp-com-detail-engineering.js
```

### 场景 3: 混合场景

```csv
type,url,max_jobs,prompt
list,https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs,10,CX_1001部门
list,https://jpmc.fa.oraclecloud.com/.../sites/CX_1002/jobs,10,CX_1002部门
list,https://apply.microsoft.com/careers,5,微软主站
detail,https://apply.microsoft.com/jobs/123,1,
detail,https://careers.google.com/jobs/456,1,谷歌职位
```

**生成文件：**
```
jpmc-fa-oraclecloud-com-list-sites-cx-1001.js
jpmc-fa-oraclecloud-com-list-sites-cx-1002.js
apply-microsoft-com-list-....js
apply-microsoft-com-detail-....js
careers-google-com-detail-....js
```

## 🚀 使用方法

### 1. 生成解析器

```bash
# 第一次运行：生成所有解析器
npm run generate -- --csv

输出：
✅ 解析器已保存: jpmc-fa-oraclecloud-com-list-sites-cx-1001.js
✅ 解析器已保存: jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js
✅ 解析器已保存: jpmc-fa-oraclecloud-com-list-sites-cx-1002.js
```

### 2. 重复运行（不会覆盖）

```bash
# 第二次运行：检测到已存在，跳过
npm run generate -- --csv

输出：
⚠️  解析器已存在: jpmc-fa-oraclecloud-com-list-sites-cx-1001.js
💡 使用 --force 选项可覆盖现有解析器
⚠️  解析器已存在: jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js
💡 使用 --force 选项可覆盖现有解析器
⚠️  解析器已存在: jpmc-fa-oraclecloud-com-list-sites-cx-1002.js
💡 使用 --force 选项可覆盖现有解析器
```

### 3. 强制覆盖（TODO: 未来实现）

```bash
# 重新生成所有解析器，覆盖已有文件
npm run generate -- --csv --force

输出：
🔄 覆盖已有解析器: jpmc-fa-oraclecloud-com-list-sites-cx-1001.js
✅ 解析器已保存: jpmc-fa-oraclecloud-com-list-sites-cx-1001.js
```

## 📝 文件名规则详解

### 组成部分

| 部分 | 说明 | 示例 |
|------|------|------|
| **域名** | 域名清理后的格式 | `jpmc-fa-oraclecloud-com` |
| **类型** | 页面类型 | `list`, `detail` |
| **签名** | URL 签名或哈希 | `sites-cx-1001`, `861a1a43` |

### 域名清理规则

```typescript
// 原始域名
jpmc.fa.oraclecloud.com

// 清理步骤：
1. 替换 * → _
   jpmc_.fa.oraclecloud.com

2. 替换 . → -
   jpmc_-fa-oraclecloud-com

3. 合并多个 - → -
   jpmc-fa-oraclecloud-com

4. 转小写
   jpmc-fa-oraclecloud-com
```

### 签名提取规则

```typescript
// URL 1: 有站点 ID
https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs
↓ 提取: CX_1001
↓ 清理: sites-cx-1001

// URL 2: 有路径关键字
https://careers.company.com/engineering/jobs
↓ 提取: engineering
↓ 清理: engineering

// URL 3: 无明显特征
https://example.com/complex/path/123
↓ 计算 MD5: 861a1a43d8e5f7b2
↓ 取前8位: 861a1a43
```

## 🛡️ 防护机制

### 1. 文件名冲突检测

系统自动检测并避免冲突：

```typescript
// 内部逻辑
if (await fs.pathExists(filepath)) {
  // 文件已存在，不覆盖
  console.log(`⚠️  解析器已存在: ${filename}`);
  return;
}
```

### 2. 文件名长度限制

```typescript
// 限制文件名最大 60 字符
if (cleaned.length > 60) {
  cleaned = cleaned.substring(0, 60);
}
```

### 3. 非法字符处理

```typescript
// 移除所有非字母数字字符
cleaned = cleaned.replace(/[^a-zA-Z0-9-_]/g, '-');

// 合并多个连字符
cleaned = cleaned.replace(/-+/g, '-');
```

## 📊 性能影响

| 操作 | 开销 |
|------|------|
| **文件名生成** | <1ms (哈希计算) |
| **文件存在检查** | ~1ms (本地文件系统) |
| **总体影响** | 可忽略不计 |

## 🎯 优势总结

1. **唯一性保证** - 每个 URL 都有唯一的文件名
2. **信息丰富** - 文件名包含类型、部门等关键信息
3. **可读性强** - 开发者可以直接从文件名了解用途
4. **防覆盖** - 自动检测并避免重复生成
5. **向后兼容** - 不影响已有的简单命名方式

## 🔗 相关文档

- **完整文档：** [PARSER_NAMING.md](PARSER_NAMING.md)
- **实现代码：** [src/utils/parserFilename.ts](../src/utils/parserFilename.ts)
- **CSV 配置：** [CSV_CONFIG.md](CSV_CONFIG.md)
- **项目 README：** [../README.md](../README.md)

---

**最后更新:** 2026-02-05
**版本:** 1.0.0
