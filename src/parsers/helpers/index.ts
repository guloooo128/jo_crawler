/**
 * Parser Helpers — 解析器辅助模块
 *
 * 从 BaseParser God Class 中拆分出的独立功能模块：
 *   - TextCleaner:     文本清洗（页面文本去噪、JD 内容提取）
 *   - FieldParser:     字段提取（title、location、postDate 等结构化字段）
 *   - ListCrawler:     列表页爬取模板（翻页 + 链接收集 + 详情提取）
 *   - DetailExtractor: 详情页提取（单页完整字段提取）
 */

export { TextCleaner, type CleanDescriptionOptions } from './TextCleaner.js';
export { FieldParser, type JobMetadata } from './FieldParser.js';
export { ListCrawler, type ListCrawlerConfig, type PaginationConfig, type JobLink } from './ListCrawler.js';
export { DetailExtractor, type DetailFields, type DetailExtractorOptions } from './DetailExtractor.js';
