# 解析器文件命名策略

## 🎯 问题

当 CSV 配置文件中有相同域名但不同类型（list/detail）或不同公司/部门的 URL 时，如果使用简单的域名命名，会导致生成的解析器文件互相覆盖。

**示例：**

```csv
type,url,max_jobs,prompt
list,https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs,3,
detail,https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs/123,1,
detail,https://jpmc.fa.oraclecloud.com/.../sites/CX_1002/jobs/456,1,
```

如果都用域名命名（如 `jpmc-fa-oraclecloud-com.js`），后者会覆盖前者。

## ✅ 解决方案

使用**三段式命名**策略：`域名-类型-URL签名`

### 命名格式

```
<域名>-<页面类型>-<URL签名>.js
```

#### 示例 1: 不同类型的相同域名

```csv
list,https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs,3,
detail,https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs/123,1,
```

生成文件：
```
jpmc-fa-oraclecloud-com-list-sites-cx-1001.js
jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js
```

#### 示例 2: 相同类型但不同部门/公司

```csv
list,https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs,5,
list,https://jpmc.fa.oraclecloud.com/.../sites/CX_1002/jobs,5,
```

生成文件：
```
jpmc-fa-oraclecloud-com-list-sites-cx-1001.js
jpmc-fa-oraclecloud-com-list-sites-cx-1002.js
```

#### 示例 3: URL 无明显特征时

```csv
detail,https://careers.microsoft.com/job/123,1,
```

生成文件（使用 URL 哈希）：
```
apply-careers-microsoft-com-detail-861a1a43.js
```

## 🔧 URL 签名提取策略

### 优先级 1: 站点 ID

从 URL 路径中提取站点或公司 ID：

```url
https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs
```

提取：`CX_1001` → `sites-cx-1001`

### 优先级 2: 路径关键字

使用路径的最后两个部分：

```url
https://careers.microsoft.com/search/results
```

提取：`search-results` → `search-results`

### 优先级 3: URL 哈希

如果 URL 没有明显特征，使用 MD5 哈希的前 8 位：

```url
https://example.com/jobs/12345
```

生成：`861a1a43`（哈希前 8 位）

## 📝 完整示例

### 输入 CSV

```csv
type,url,max_jobs,prompt
list,https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs,10,
detail,https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs/preview/210690325,1,
list,https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1002/jobs,15,
detail,https://apply.careers.microsoft.com/careers?start=0,5,提取发布日期
```

### 生成的解析器文件

```
jpmc-fa-oraclecloud-com-list-sites-cx-1001.js          # CX_1001 列表页
jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js        # CX_1001 详情页
jpmc-fa-oraclecloud-com-list-sites-cx-1002.js          # CX_1002 列表页
apply-careers-microsoft-com-detail-861a1a43.js         # Microsoft 详情页（哈希）
```

## 🛡️ 避免重复生成

### 机制

在保存解析器前，系统会检查文件是否已存在：

1. **如果文件已存在：**
   - 显示警告：`⚠️  解析器已存在: filename.js`
   - 提示：`💡 使用 --force 选项可覆盖现有解析器`
   - **跳过保存**，不会覆盖已有文件

2. **如果文件不存在：**
   - 生成并保存新解析器
   - 显示：`✅ 解析器已保存: filepath`

### 示例输出

```bash
$ npm run generate -- --csv

🔍 正在分析: https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs
...
💾 保存解析器...
✅ 解析器已保存: src/parsers/generated/jpmc-fa-oraclecloud-com-list-sites-cx-1001.js

🔍 正在分析: https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs/123
...
💾 保存解析器...
⚠️  解析器已存在: jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js
💡 使用 --force 选项可覆盖现有解析器

# 第二次运行相同命令
$ npm run generate -- --csv

🔍 正在分析: https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs
...
💾 保存解析器...
⚠️  解析器已存在: jpmc-fa-oraclecloud-com-list-sites-cx-1001.js
💡 使用 --force 选项可覆盖现有解析器
```

## 🎨 文件名规则

### 允许的字符

- 小写字母 (a-z)
- 数字 (0-9)
- 连字符 (-)
- 下划线 (_)

### 转换规则

1. **域名清理：**
   - `*.example.com` → `*-example-com`
   - `sub.domain.com` → `sub-domain-com`

2. **特殊字符处理：**
   - 所有非字母数字字符转换为 `-`
   - 多个 `-` 合并为一个
   - 移除开头和结尾的 `-`

3. **长度限制：**
   - 最大 60 个字符
   - 自动截断超长文件名

### 类名生成

解析器类名从文件名生成（PascalCase）：

```javascript
// 文件名
jpmc-fa-oraclecloud-com-list-sites-cx-1001.js

// 类名
JpmcFaOraclecloudComListSitesCx1001
```

## 📊 实际应用场景

### 场景 1: 多公司招聘

```csv
type,url,max_jobs,prompt
list,https://companyA.com/jobs,10,
list,https://companyB.com/jobs,10,
detail,https://companyA.com/jobs/123,1,
detail,https://companyB.com/jobs/456,1,
```

生成：
```
companya-com-list-....js
companyb-com-list-....js
companya-com-detail-....js
companyb-com-detail-....js
```

### 场景 2: 多部门招聘（同域名）

```csv
type,url,max_jobs,prompt
list,https://careers.company.com/engineering,10,
list,https://careers.company.com/sales,10,
detail,https://careers.company.com/engineering/123,1,
detail,https://careers.company.com/sales/456,1,
```

生成：
```
careers-company-com-list-engineering.js
careers-company-com-list-sales.js
careers-company-com-detail-engineering.js
careers-company-com-detail-sales.js
```

### 场景 3: 混合场景

```csv
type,url,max_jobs,prompt
list,https://jpmc.fa.oraclecloud.com/.../sites/CX_1001/jobs,10,CX_1001 部门
list,https://jpmc.fa.oraclecloud.com/.../sites/CX_1002/jobs,10,CX_1002 部门
detail,https://apply.microsoft.com/jobs/123,1,微软职位
detail,https://apply.google.com/jobs/456,1,谷歌职位
```

生成：
```
jpmc-fa-oraclecloud-com-list-sites-cx-1001.js
jpmc-fa-oraclecloud-com-list-sites-cx-1002.js
apply-microsoft-com-detail-....js
apply-google-com-detail-....js
```

## 🔍 查找现有解析器

系统提供工具函数用于查找现有解析器：

### `hasParserForUrl()`

检查是否已经为某个 URL 生成了解析器：

```typescript
import { hasParserForUrl } from './utils/parserFilename.js';

const existing = true; // 已存在的解析器文件名
const exists = hasParserForUrl(
  existing,
  'jpmc.fa.oraclecloud.com',
  'https://.../sites/CX_1001/jobs',
  'list'
);
// 返回: true 或 false
```

### `findMatchingParser()`

为 URL 查找最匹配的现有解析器：

```typescript
import { findMatchingParser } from './utils/parserFilename.js';

const existingParsers = [
  'jpmc-fa-oraclecloud-com-list-sites-cx-1001.js',
  'apply-careers-microsoft-com-detail-861a1a43.js',
];

const matched = findMatchingParser(
  existingParsers,
  'jpmc.fa.oraclecloud.com',
  'https://.../sites/CX_1001/jobs/123'
);
// 返回: 'jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js' 或 null
```

## 📚 相关文件

- **实现：** [src/utils/parserFilename.ts](../src/utils/parserFilename.ts)
- **使用：** [src/services/LLMService.ts](../src/services/LLMService.ts)
- **配置：** [links.csv](../links.csv)
- **模型：** [src/models/LinksConfig.ts](../src/models/LinksConfig.ts)

---

**最后更新:** 2026-02-05
