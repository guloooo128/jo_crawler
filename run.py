"""配置驱动职位爬虫 - 入口脚本

用法:
    python run.py <URL>                     # 自动匹配配置，无配置则自动生成
    python run.py <URL> --config path.json  # 指定配置文件
    python run.py <URL> --no-auto           # 禁止自动生成配置
    python run.py <URL> -l 50              # 最多爬取 50 个职位（不够自动翻页）
    python run.py --batch urls.txt          # 批量处理（无配置时自动生成）
    python run.py --batch urls.txt -j 5     # 批量处理，5 路并发
"""

import argparse
import asyncio
import builtins
import io
import json
from collections import defaultdict
from contextvars import ContextVar
from pathlib import Path
from urllib.parse import urlparse

from browser_service import BrowserService
from crawler import JobCrawler

# 并发日志缓冲：每个协程的 print 输出先写到自己的 buffer，完成后一次性输出
_log_buffer: ContextVar[io.StringIO | None] = ContextVar("_log_buffer", default=None)
_original_print = builtins.print


def _buffered_print(*args, **kwargs):
    """替换内置 print：如果当前协程有 buffer 就写入 buffer，否则直接输出"""
    buf = _log_buffer.get(None)
    if buf is not None:
        kwargs["file"] = buf
    _original_print(*args, **kwargs)

CONFIG_DIR = Path(__file__).parent / "config"


def _strip_www(domain: str) -> str:
    """去掉 www. 前缀: www.example.com → example.com"""
    return domain[4:] if domain.startswith("www.") else domain


def load_config_for_url(url: str) -> dict | None:
    """根据 URL 域名自动匹配 config/ 下的配置文件

    匹配优先级：
      1. 精确匹配完整域名（忽略 www 前缀）
      2. 同平台子域名匹配（去掉 www 后，要求配置域名是目标域名的后缀或反之，
         且共享至少三级域名，避免 www.microsoft.com 错配 apply.careers.microsoft.com）
    """
    domain = urlparse(url).netloc.lower()
    domain_no_www = _strip_www(domain)

    # 加载所有配置
    configs = []
    for config_file in CONFIG_DIR.glob("*.json"):
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                config = json.load(f)
            configs.append((config_file, config))
        except Exception:
            continue

    # 第一轮：精确匹配（忽略 www 前缀）
    for config_file, config in configs:
        config_domain = _strip_www(config.get("domain", ""))
        if config_domain == domain_no_www:
            print(f"匹配配置: {config_file.name} (精确匹配)")
            return config

    # 第二轮：同平台子域名匹配
    # 只匹配至少三段的域名（如 td.wd3.myworkdayjobs.com），
    # 且要求去掉最左边的子域名后剩余部分相同
    # 这样 td.wd3.myworkdayjobs.com ↔ xx.wd3.myworkdayjobs.com 可以匹配
    # 但 www.microsoft.com ↔ apply.careers.microsoft.com 不会匹配
    domain_parts = domain_no_www.split(".")
    if len(domain_parts) >= 3:
        domain_suffix = ".".join(domain_parts[1:])  # 去掉最左子域名
        for config_file, config in configs:
            config_domain = _strip_www(config.get("domain", ""))
            config_parts = config_domain.split(".")
            if len(config_parts) >= 3:
                config_suffix = ".".join(config_parts[1:])
                if config_suffix == domain_suffix:
                    print(f"匹配配置: {config_file.name} (子域名匹配 {config_domain})")
                    return config

    return None


def load_config_file(path: str) -> dict:
    """加载指定配置文件"""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


async def crawl_one(url: str, config: dict, limit: int = 0, headed: bool = False) -> list[dict]:
    """爬取单个 URL"""
    headless = not headed and config.get("headless", True)
    session_name = urlparse(url).netloc.replace(".", "_")

    browser = BrowserService(session=session_name, headless=headless)
    crawler = JobCrawler(browser)

    try:
        jobs = await crawler.crawl(url, config, limit=limit)
        return jobs
    finally:
        await browser.close()


async def _ensure_config(url: str, no_auto: bool = False, headed: bool = False) -> dict | None:
    """确保有配置：先查本地，没有则自动生成"""
    config = load_config_for_url(url)
    if config:
        return config

    if no_auto:
        print(f"未找到 {urlparse(url).netloc} 的配置文件")
        print(f"提示: 去掉 --no-auto 可自动生成配置")
        return None

    print(f"未找到 {urlparse(url).netloc} 的配置，自动生成中...")
    from auto_gen import generate_config
    config = await generate_config(url, headed=headed)
    if not config:
        print(f"自动生成配置失败，可手动生成:")
        print(f'  python gen_config.py --url "{url}" --file dom.html')
    return config


async def main():
    parser = argparse.ArgumentParser(description="配置驱动职位爬虫")
    parser.add_argument("url", nargs="?", help="目标 URL")
    parser.add_argument("--config", "-c", help="指定配置文件路径")
    parser.add_argument("--batch", "-b", help="批量 URL 文件路径")
    parser.add_argument("--output", "-o", help="输出 JSON 文件路径")
    parser.add_argument("--no-auto", action="store_true", help="禁止自动生成配置")
    parser.add_argument("--headed", action="store_true", help="强制使用有头浏览器（可视化调试）")
    parser.add_argument("--limit", "-l", type=int, default=50, help="最大爬取职位数（默认 50，0 表示不限制）")
    parser.add_argument("--concurrency", "-j", type=int, default=1, help="批量模式并发数（默认 3）")
    args = parser.parse_args()

    if args.batch:
        # 批量模式 — 并发时用缓冲 print 避免日志交错
        if args.concurrency > 1:
            builtins.print = _buffered_print

        with open(args.batch, "r") as f:
            urls = [line.strip() for line in f if line.strip() and not line.startswith("#")]

        output_path = args.output or "batch_results.json"
        concurrency = args.concurrency

        # 加载已有结果（支持断点续爬）
        all_results = []
        done_urls = set()
        if Path(output_path).exists():
            try:
                with open(output_path, "r", encoding="utf-8") as f:
                    all_results = json.load(f)
                done_urls = {r["url"] for r in all_results}
                if done_urls:
                    print(f"已加载 {len(done_urls)} 个已处理的 URL，跳过")
            except Exception:
                pass

        # 过滤掉已处理的 URL，保留原始序号
        pending_urls = [(i, url) for i, url in enumerate(urls, 1) if url not in done_urls]
        skipped = len(urls) - len(pending_urls)
        if skipped:
            print(f"跳过 {skipped} 个已处理的 URL")

        if not pending_urls:
            print("所有 URL 已处理完成")
        else:
            # 按域名分组：组内串行（共享 session），组间并发
            domain_groups = defaultdict(list)
            for idx, url in pending_urls:
                domain = urlparse(url).netloc.lower()
                domain_groups[domain].append((idx, url))

            print(f"待处理: {len(pending_urls)} 个 URL，{len(domain_groups)} 个域名，并发数: {concurrency}")

            success_count = 0
            fail_count = 0
            results_lock = asyncio.Lock()
            semaphore = asyncio.Semaphore(concurrency)

            async def _process_one(idx: int, url: str):
                """处理单个 URL，由域名组协程调用（已在 semaphore 内）"""
                nonlocal success_count, fail_count
                tag = f"[{idx}/{len(urls)}]"

                # 每个任务用独立 buffer 收集日志，完成后一次性输出
                buf = io.StringIO()
                _log_buffer.set(buf)

                print(f"\n{'='*60}")
                print(f"{tag} {url}")
                print(f"{'='*60}")

                result = {"index": idx, "url": url, "status": "fail", "error": "", "jobs": []}
                is_success = False

                try:
                    config = await _ensure_config(url, no_auto=args.no_auto, headed=args.headed)
                    if not config:
                        result["error"] = "配置生成失败"
                        print(f"{tag} 失败: 配置生成失败")
                    else:
                        jobs = await crawl_one(url, config, limit=args.limit, headed=args.headed)
                        jobs = [j for j in jobs if j.get("title", "").strip()]
                        result["jobs"] = jobs
                        if jobs:
                            result["status"] = "success"
                            is_success = True
                            print(f"{tag} 成功: {len(jobs)} 个职位")
                        else:
                            result["error"] = "未提取到职位"
                            print(f"{tag} 失败: 未提取到职位")
                except Exception as e:
                    print(f"{tag} 错误: {e}")
                    result["error"] = str(e)

                # 一次性输出日志 + 更新计数 + 增量保存（同一把锁，避免交错）
                _log_buffer.set(None)
                async with results_lock:
                    log_text = buf.getvalue()
                    if log_text:
                        _original_print(log_text, end="")
                    if is_success:
                        success_count += 1
                    else:
                        fail_count += 1
                    all_results.append(result)
                    all_results.sort(key=lambda r: r.get("index", 0))
                    with open(output_path, "w", encoding="utf-8") as f:
                        json.dump(all_results, f, ensure_ascii=False, indent=2)

            async def _process_domain_group(group_urls: list[tuple[int, str]]):
                """处理同域名的一组 URL：获取信号量后串行执行"""
                async with semaphore:
                    for idx, url in group_urls:
                        await _process_one(idx, url)

            group_tasks = [_process_domain_group(group) for group in domain_groups.values()]
            await asyncio.gather(*group_tasks)

            # 恢复原始 print
            builtins.print = _original_print

            print(f"\n{'='*60}")
            print(f"批量处理完成: 成功 {success_count}, 失败 {fail_count}, "
                  f"跳过 {skipped}, 总计 {len(urls)}")
            print(f"结果已保存: {output_path}")
            print(f"{'='*60}")

    elif args.url:
        # 单 URL 模式
        if args.config:
            config = load_config_file(args.config)
        else:
            config = await _ensure_config(args.url, no_auto=args.no_auto, headed=args.headed)
            if not config:
                return

        jobs = await crawl_one(args.url, config, limit=args.limit, headed=args.headed)
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
