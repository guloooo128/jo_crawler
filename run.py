"""配置驱动职位爬虫 - 入口脚本

用法:
    python run.py <URL>                     # 自动匹配配置
    python run.py <URL> --config path.json  # 指定配置文件
    python run.py --batch urls.txt          # 批量处理
"""

import argparse
import asyncio
import json
from pathlib import Path
from urllib.parse import urlparse

from browser_service import BrowserService
from crawler import JobCrawler

CONFIG_DIR = Path(__file__).parent / "config"


def _get_top_domain(domain: str) -> str:
    """提取一级域名: td.wd3.myworkdayjobs.com → myworkdayjobs.com"""
    parts = domain.split(".")
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    return domain


def load_config_for_url(url: str) -> dict | None:
    """根据 URL 域名自动匹配 config/ 下的配置文件

    匹配优先级：
      1. 精确匹配完整域名
      2. 按一级域名匹配（同一平台不同子域名共享配置）
    """
    domain = urlparse(url).netloc.lower()

    # 加载所有配置
    configs = []
    for config_file in CONFIG_DIR.glob("*.json"):
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                config = json.load(f)
            configs.append((config_file, config))
        except Exception:
            continue

    # 第一轮：精确匹配完整域名
    for config_file, config in configs:
        if config.get("domain") == domain:
            print(f"匹配配置: {config_file.name} (精确匹配)")
            return config

    # 第二轮：按一级域名匹配（同一平台不同子域名共享配置）
    top_domain = _get_top_domain(domain)
    for config_file, config in configs:
        config_domain = config.get("domain", "")
        if _get_top_domain(config_domain) == top_domain:
            print(f"匹配配置: {config_file.name} (一级域名匹配 {config_domain})")
            return config

    return None


def load_config_file(path: str) -> dict:
    """加载指定配置文件"""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


async def crawl_one(url: str, config: dict) -> list[dict]:
    """爬取单个 URL"""
    headless = config.get("headless", True)
    session_name = urlparse(url).netloc.replace(".", "_")

    browser = BrowserService(session=session_name, headless=headless)
    crawler = JobCrawler(browser)

    try:
        jobs = await crawler.crawl(url, config)
        return jobs
    finally:
        await browser.close()


async def main():
    parser = argparse.ArgumentParser(description="配置驱动职位爬虫")
    parser.add_argument("url", nargs="?", help="目标 URL")
    parser.add_argument("--config", "-c", help="指定配置文件路径")
    parser.add_argument("--batch", "-b", help="批量 URL 文件路径")
    parser.add_argument("--output", "-o", help="输出 JSON 文件路径")
    args = parser.parse_args()

    if args.batch:
        # 批量模式
        with open(args.batch, "r") as f:
            urls = [line.strip() for line in f if line.strip() and not line.startswith("#")]

        all_results = []
        for i, url in enumerate(urls, 1):
            print(f"\n{'='*60}")
            print(f"[{i}/{len(urls)}] {url}")
            print(f"{'='*60}")

            config = load_config_for_url(url)
            if not config:
                print(f"  未找到配置，跳过")
                all_results.append({"url": url, "error": "no config", "jobs": []})
                continue

            jobs = await crawl_one(url, config)
            jobs = [j for j in jobs if j.get("title", "").strip()]
            all_results.append({"url": url, "jobs": jobs})
            print(f"  完成: {len(jobs)} 个职位")

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(all_results, f, ensure_ascii=False, indent=2)
            print(f"\n结果已保存: {args.output}")

    elif args.url:
        # 单 URL 模式
        if args.config:
            config = load_config_file(args.config)
        else:
            config = load_config_for_url(args.url)
            if not config:
                print(f"未找到 {urlparse(args.url).netloc} 的配置文件")
                print(f"请在 config/ 目录下创建对应的 JSON 配置")
                return

        jobs = await crawl_one(args.url, config)
        jobs = [j for j in jobs if j.get("title", "").strip()]

        print(f"\n{'='*60}")
        print(f"提取完成: {len(jobs)} 个职位")
        print(f"{'='*60}\n")

        for i, job in enumerate(jobs, 1):
            print(f"{i}. {job.get('title', 'N/A')}")
            print(f"   URL: {job.get('url', 'N/A')}")
            for key in job:
                if key not in ("title", "url", "_index"):
                    print(f"   {key}: {job[key]}")
            print()

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(jobs, f, ensure_ascii=False, indent=2)
            print(f"结果已保存: {args.output}")
    else:
        parser.print_help()


if __name__ == "__main__":
    asyncio.run(main())
