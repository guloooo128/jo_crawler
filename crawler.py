"""配置驱动的职位爬虫核心模块"""

import json
from browser_service import BrowserService


def _parse_json(raw: str):
    """解析 eval_js 返回的可能多层编码的 JSON"""
    result = raw
    for _ in range(3):
        if isinstance(result, (dict, list)):
            return result
        result = json.loads(result)
    return result


def _build_fields_js(fields: dict) -> str:
    """根据 field_map 生成 JS 字段提取代码片段"""
    parts = []
    for name, selector in fields.items():
        escaped = selector.replace("'", "\\'")
        parts.append(
            f"    {name}: card.querySelector('{escaped}')?.textContent?.trim() || ''"
        )
    return ",\n".join(parts)


class JobCrawler:
    """配置驱动的职位爬虫

    通过 JSON 配置文件定义：
    - card_selector: 定位职位卡片
    - fields: 从卡片提取字段
    - url_mode: 如何获取详情 URL
    """

    def __init__(self, browser: BrowserService):
        self.browser = browser

    async def crawl(self, url: str, config: dict, limit: int = 0) -> list[dict]:
        """根据配置爬取职位列表

        Args:
            url: 目标页面 URL
            config: 站点配置字典
            limit: 最大爬取数量，0 表示不限制

        Returns:
            职位列表 [{title, url, date?, category?, location?, ...}]
        """
        browser = self.browser

        # 1. 打开页面
        print(f"  打开: {url}")
        await browser.navigate(url)

        # 2. 执行 pre_actions
        for action in config.get("pre_actions", []):
            await self._run_action(action)

        # 3. 提取卡片字段数据
        card_selector = config["card_selector"]
        fields = config["fields"]
        print(f"  提取卡片: {card_selector}")

        jobs = await self._extract_fields(card_selector, fields)
        if not jobs:
            print("  未找到卡片")
            return []
        print(f"  找到 {len(jobs)} 个卡片")

        # 截断到 limit
        if limit > 0 and len(jobs) > limit:
            print(f"  限制爬取前 {limit} 个")
            jobs = jobs[:limit]

        # 4. 获取 detail URL
        url_mode = config.get("url_mode", "href")
        wait_ms = config.get("wait_after_click_ms", 2000)

        if url_mode == "href":
            jobs = await self._get_urls_href(card_selector, config.get("url_selector"), jobs)
        elif url_mode == "click_newtab":
            jobs = await self._get_urls_click_newtab(card_selector, jobs, wait_ms)
        elif url_mode == "click_navigate":
            jobs = await self._get_urls_click_navigate(card_selector, jobs, wait_ms)
        elif url_mode.startswith("attr:"):
            attr_name = url_mode[5:]
            jobs = await self._get_urls_attr(card_selector, attr_name, config.get("url_selector"), jobs)
        else:
            print(f"  未知 url_mode: {url_mode}")

        return jobs

    # ── Pre-actions ──────────────────────────────────────────────

    async def _run_action(self, action: dict):
        """执行单个预操作"""
        act = action["action"]
        if act == "wait_for_content":
            timeout = action.get("timeout_ms", 20000)
            print(f"  等待内容加载 (timeout={timeout}ms)...")
            await self.browser.wait_for_content(timeout_ms=timeout)
        elif act == "wait":
            ms = action.get("ms", 1000)
            await self.browser.wait_ms(ms)
        elif act == "scroll":
            times = action.get("times", 3)
            print(f"  滚动页面 {times} 次...")
            await self.browser.scroll_page(times=times)
        elif act == "click":
            selector = action["selector"]
            print(f"  点击: {selector}")
            await self.browser.click(selector)
            await self.browser.wait_ms(action.get("wait_ms", 1000))
        else:
            print(f"  未知操作: {act}")

    # ── Field extraction ─────────────────────────────────────────

    async def _extract_fields(self, card_selector: str, fields: dict) -> list[dict]:
        """用一次 JS 调用提取所有卡片的字段数据"""
        fields_js = _build_fields_js(fields)
        escaped_selector = card_selector.replace("'", "\\'")

        js = f"""
        (() => {{
            const cards = document.querySelectorAll('{escaped_selector}');
            return JSON.stringify(Array.from(cards).map((card, i) => ({{
                _index: i,
{fields_js}
            }})));
        }})()
        """
        raw = await self.browser.eval_js(js)
        return _parse_json(raw)

    # ── URL extraction strategies ────────────────────────────────

    async def _get_urls_href(self, card_selector: str, url_selector: str | None, jobs: list[dict]) -> list[dict]:
        """从 href 属性提取 URL"""
        escaped_card = card_selector.replace("'", "\\'")
        if url_selector:
            escaped_url = url_selector.replace("'", "\\'")
            sub_query = f"card.querySelector('{escaped_url}')"
        else:
            sub_query = "card.querySelector('a') || card"

        js = f"""
        (() => {{
            const cards = document.querySelectorAll('{escaped_card}');
            return JSON.stringify(Array.from(cards).map(card => {{
                const el = {sub_query};
                return el ? (el.href || el.getAttribute('href') || '') : '';
            }}));
        }})()
        """
        raw = await self.browser.eval_js(js)
        urls = _parse_json(raw)

        for i, job in enumerate(jobs):
            job["url"] = urls[i] if i < len(urls) else ""
        return jobs

    async def _get_urls_attr(self, card_selector: str, attr_name: str, url_selector: str | None, jobs: list[dict]) -> list[dict]:
        """从指定属性提取 URL"""
        escaped_card = card_selector.replace("'", "\\'")
        escaped_attr = attr_name.replace("'", "\\'")
        if url_selector:
            escaped_url = url_selector.replace("'", "\\'")
            sub_query = f"card.querySelector('{escaped_url}')"
        else:
            sub_query = "card"

        js = f"""
        (() => {{
            const cards = document.querySelectorAll('{escaped_card}');
            return JSON.stringify(Array.from(cards).map(card => {{
                const el = {sub_query};
                return el ? (el.getAttribute('{escaped_attr}') || '') : '';
            }}));
        }})()
        """
        raw = await self.browser.eval_js(js)
        urls = _parse_json(raw)

        for i, job in enumerate(jobs):
            job["url"] = urls[i] if i < len(urls) else ""
        return jobs

    def _build_click_js(self, card_selector: str, index: int) -> str:
        """生成点击卡片的 JS，优先点击卡片内的 <a> 子元素"""
        escaped = card_selector.replace('"', '\\"')
        return f"""
        (() => {{
            const cards = document.querySelectorAll("{escaped}");
            if (cards.length <= {index}) return 'not_found';
            const card = cards[{index}];
            const link = card.querySelector('a') || card;
            link.click();
            return 'ok';
        }})()
        """

    async def _get_urls_click_newtab(self, card_selector: str, jobs: list[dict], wait_ms: int) -> list[dict]:
        """逐个点击卡片，从新 tab 获取 URL。如果没有新 tab 但 URL 变了，自动回退"""
        list_url = await self.browser.get_url()

        for i, job in enumerate(jobs):
            print(f"    [{i+1}/{len(jobs)}] 点击: {job.get('title', '?')[:40]}...")

            tabs_before = await self.browser.get_tabs()

            result = await self.browser.eval_js(self._build_click_js(card_selector, i))
            if 'not_found' in result:
                print(f"      卡片不存在，跳过")
                job["url"] = ""
                continue

            await self.browser.wait_ms(wait_ms)

            tabs_after = await self.browser.get_tabs()
            if len(tabs_after) > len(tabs_before):
                # 新 tab 打开了
                await self.browser.switch_tab(len(tabs_after) - 1)
                await self.browser.wait_ms(1000)
                detail_url = await self.browser.get_url()
                job["url"] = detail_url
                print(f"      -> {detail_url}")

                await self.browser.close_tab()
                await self.browser.switch_tab(0)
                await self.browser.wait_ms(500)
            else:
                # 没有新 tab，检查当前页 URL 是否变化（SPA 路由跳转）
                current_url = await self.browser.get_url()
                if current_url != list_url:
                    job["url"] = current_url
                    print(f"      (页内跳转) -> {current_url}")
                    await self.browser.go_back()
                    await self.browser.wait_ms(1500)
                else:
                    job["url"] = ""
                    print(f"      (未跳转)")

        return jobs

    async def _get_urls_click_navigate(self, card_selector: str, jobs: list[dict], wait_ms: int) -> list[dict]:
        """逐个点击卡片，从 URL 变化获取详情链接"""
        for i, job in enumerate(jobs):
            print(f"    [{i+1}/{len(jobs)}] 点击: {job.get('title', '?')[:40]}...")

            result = await self.browser.eval_js(self._build_click_js(card_selector, i))
            if 'not_found' in result:
                job["url"] = ""
                continue

            await self.browser.wait_ms(wait_ms)

            detail_url = await self.browser.get_url()
            job["url"] = detail_url
            print(f"      -> {detail_url}")

            # 返回列表页
            await self.browser.go_back()
            await self.browser.wait_ms(1500)

        return jobs
