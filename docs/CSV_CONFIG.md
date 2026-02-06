# CSV 配置文件使用指南

JO Crawler 支持使用 CSV 格式的配置文件（`links.csv`）来灵活配置每个 URL 的爬取参数。

## 📋 CSV 文件格式

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 页面类型：`list`(列表页) 或 `detail`(详情页) |
| `url` | string | 是 | 目标网站的完整 URL |
| `max_jobs` | number | 否 | 最大爬取职位数，默认 `10` |
| `prompt` | string | 否 | 自定义提示词，用于优化解析器生成 |

### 示例文件

```csv
# JO Crawler 配置文件
# 字段: type, url, max_jobs, prompt

type,url,max_jobs,prompt
list,https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs?keyword=intern,10,
detail,https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs/preview/210690325/?keyword=intern,1,
list,https://apply.careers.microsoft.com/careers?start=0&pid=1970393556749000&sort_by=timestamp,5,这个页面的职位卡片包含日期信息，请提取发布日期
```

## 🎯 页面类型 (type)

### list - 列表页
包含多个职位的页面，需要：
- 遍历职位卡片
- 点击进入详情页
- 提取每个职位的完整信息

**示例：**
```csv
list,https://example.com/jobs,20,
```

### detail - 详情页
单个职位的完整信息页面，直接：
- 提取职位标题
- 提取职位描述
- 提取其他元数据

**示例：**
```csv
detail,https://example.com/jobs/123,1,
```

## 💡 自定义 Prompt

`prompt` 字段允许你为特定网站提供额外的提示词，帮助 LLM 生成更准确的解析器。

### 使用场景

#### 1. 提示特殊结构
```csv
list,https://example.com/jobs,10,职位信息在 iframe 中，需要切换 frame
```

#### 2. 提示重要字段
```csv
detail,https://example.com/jobs/123,1,这个页面的薪资信息在侧边栏，请提取
```

#### 3. 提示反爬虫处理
```csv
list,https://careers.company.com,5,这个网站有强反爬虫，需要增加延迟到 3 秒
```

#### 4. 提示数据格式
```csv
list,https://jobs.example.com,10,职位发布日期格式为 "Posted 2 days ago"，需要转换为标准日期
```

## 📝 最佳实践

### 1. 注释使用
CSV 支持 `#` 开头的注释行：

```csv
# 这是注释行
# 列表页 - JPMorgan Chase
list,https://jpmc.fa.oraclecloud.com/jobs,10,

# 详情页 - Microsoft
detail,https://careers.microsoft.com/job/123,1,
```

### 2. 合理设置 max_jobs

- **列表页：** 根据需要设置，通常 `5-20`
- **详情页：** 通常为 `1`（只有一个职位）

```csv
list,https://example.com/jobs,5,       # 只爬取前 5 个职位（测试用）
list,https://example.com/jobs,50,      # 爬取前 50 个职位（生产用）
detail,https://example.com/job/123,1,  # 详情页通常只爬 1 个
```

### 3. 按网站分组

建议按网站或域名分组配置：

```csv
# ===== JPMorgan Chase =====
list,https://jpmc.fa.oraclecloud.com/jobs,15,
detail,https://jpmc.fa.oraclecloud.com/jobs/1001,1,

# ===== Microsoft =====
list,https://careers.microsoft.com/jobs,10,注意：此网站需要滚动加载
detail,https://careers.microsoft.com/job/123,1,

# ===== Google =====
list,https://careers.google.com/jobs,20,
```

## 🔄 从 TXT 迁移到 CSV

### 旧格式 (links.txt)
```
https://example.com/jobs
https://another-site.com/careers
```

### 新格式 (links.csv)
```csv
type,url,max_jobs,prompt
auto,https://example.com/jobs,10,
auto,https://another-site.com/careers,10,
```

> **提示：** `type` 为 `auto` 时，系统会自动判断页面类型

## 🚀 使用方法

### 1. 使用 CSV 配置生成解析器

```bash
# 自动检测并使用 links.csv
npm run generate

# 显式指定使用 CSV
npm run generate -- --csv

# 使用旧的 TXT 格式
npm run generate -- --txt
```

### 2. 爬取时使用 CSV 配置

```bash
# 暂时：爬取命令仍使用 links.txt
npm run crawl

# TODO: 未来版本将支持 CSV 配置
npm run crawl -- --csv
```

## 📊 配置示例

### 示例 1: 基础配置
```csv
type,url,max_jobs,prompt
list,https://example.com/jobs,10,
detail,https://example.com/jobs/123,1,
```

### 示例 2: 带自定义提示
```csv
type,url,max_jobs,prompt
list,https://careers.company.com/jobs,15,职位卡片包含薪资范围，请提取
detail,https://careers.company.com/jobs/500,1,申请按钮在页面底部，需要滚动
```

### 示例 3: 测试配置
```csv
# 测试配置 - 只爬取少量职位
type,url,max_jobs,prompt
list,https://example.com/jobs,2,测试：只爬前 2 个职位
detail,https://example.com/jobs/123,1,测试：单个职位详情页
```

### 示例 4: 生产配置
```csv
# 生产环境配置
type,url,max_jobs,prompt
list,https://example.com/jobs,100,完整爬取：所有职位
list,https://careers.company.com/jobs,50,完整爬取：需要处理分页
detail,https://example.com/jobs/100,1,
```

## ⚠️ 注意事项

1. **编码格式：** CSV 文件必须使用 UTF-8 编码
2. **字段分隔：** 使用逗号分隔字段
3. **URL 有效性：** 确保所有 URL 可以正常访问
4. **prompt 长度：** 自定义提示词不宜过长（建议 < 200 字）
5. **类型正确：** `type` 必须是 `list`、`detail` 或 `auto`

## 🔍 故障排除

### 问题 1: CSV 解析失败
**错误信息：** `CSV 配置文件包含错误`

**解决方法：**
- 检查字段分隔符是否为逗号
- 确保每行有 4 个字段
- 检查 URL 是否包含逗号（需要用引号包围）

### 问题 2: URL 无效
**错误信息：** `无效的 URL: xxx`

**解决方法：**
- 确保URL 以 `http://` 或 `https://` 开头
- 检查 URL 是否完整

### 问题 3: 页面类型错误
**错误信息：** `无效的页面类型: xxx`

**解决方法：**
- `type` 字段只能是：`list`、`detail` 或 `auto`
- 检查拼写是否正确

## 📚 相关文档

- [Prompt 结构说明](PROMPT_STRUCTURE.md)
- [实现总结](../IMPLEMENTATION_SUMMARY.md)
- [项目 README](../README.md)
