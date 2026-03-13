"""配置驱动的职位爬虫核心模块"""

import re
import json
import asyncio
from urllib.parse import urljoin, urlparse
from browser_service import BrowserService


def _escape_for_js(selector: str) -> str:
    """转义 CSS 选择器以安全嵌入 JS 单引号字符串。

    先转义反斜杠（CSS.escape 生成的 \\/ 等），再转义单引号。
    """
    return selector.replace("\\", "\\\\").replace("'", "\\'")


def _relax_selector(selector: str) -> str:
    """去掉 CSS 选择器中的 :nth-of-type() / :nth-child() 位置限定。

    例: 'div.foo:nth-of-type(3) > span' -> 'div.foo > span'
    """
    return re.sub(r":nth-(?:of-type|child)\(\d+\)", "", selector)


def _parse_json(raw):
    """解析 eval_js 返回的可能多层编码的 JSON"""
    if raw is None:
        return []
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
        escaped = _escape_for_js(selector)
        # 克隆节点并移除 <script>/<style> 再取文本，避免抓到内联 JS 代码
        parts.append(
            f"    {name}: (() => {{"
            f" const el = card.querySelector('{escaped}');"
            f" if (!el) return '';"
            f" const clone = el.cloneNode(true);"
            f" clone.querySelectorAll('script,style').forEach(s => s.remove());"
            f" return clone.textContent.trim();"
            f" }})()"
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
        """根据配置爬取职位列表，支持自动翻页

        Args:
            url: 目标页面 URL
            config: 站点配置字典
            limit: 最大爬取数量，0 表示不限制

        Returns:
            职位列表 [{title, url, date?, category?, location?, ...}]
        """
        browser = self.browser
        card_selector = config["card_selector"]
        fields = config["fields"]

        # 1. 打开页面
        print(f"  打开: {url}")
        await browser.navigate(url)

        # 2. 执行非等待类 pre_actions（click / scroll 等）
        for action in config.get("pre_actions", []):
            if action.get("action") == "wait_for_content":
                continue  # 由 _wait_for_cards 统一承担等待
            await self._run_action(action)

        # 2.5 自动尝试关闭弹窗
        try:
            dismissed = await browser.dismiss_popup()
            if dismissed:
                print("  关闭了弹窗")
        except Exception:
            pass

        # 3. 等待目标卡片出现并稳定（替代通用 wait_for_content，更快更准）
        card_count = await self._wait_for_cards(card_selector)
        print(f"  提取卡片: {card_selector}")

        effective_selector = card_selector
        jobs = await self._extract_fields(card_selector, fields)

        # 选择器匹配失败时，尝试去掉 :nth-of-type / :nth-child 等位置限定
        if not jobs and card_count == 0:
            relaxed = _relax_selector(card_selector)
            if relaxed != card_selector:
                print(f"  原始选择器未命中，尝试简化: {relaxed}")
                relaxed_count = await self._wait_for_cards(relaxed, timeout_ms=5000)
                if relaxed_count > 0:
                    jobs = await self._extract_fields(relaxed, fields)
                    if jobs:
                        print(f"  简化选择器命中 {len(jobs)} 个卡片")
                        effective_selector = relaxed

        # 检查 fields 是否全为空（说明 card_selector 可能匹配到了错误的元素）
        if jobs:
            field_names = list(fields.keys())
            non_empty = sum(
                1 for j in jobs
                if any(str(j.get(f, "")).strip() for f in field_names)
            )
            if non_empty == 0:
                print(
                    f"  警告: '{card_selector}' 匹配到 {len(jobs)} 个元素但所有 fields 均为空"
                )
                jobs = []

        if not jobs:
            print("  未找到卡片")
            return []
        print(f"  找到 {len(jobs)} 个卡片")

        # 3.5 提取 URL 前先截断到 limit（避免对多余卡片执行点击）
        if limit > 0 and len(jobs) > limit:
            jobs = jobs[:limit]

        # 使用实际命中的选择器（可能是简化后的）提取 URL
        if effective_selector != card_selector:
            config = {**config, "card_selector": effective_selector}

        # 4. 第一页提取 URL
        jobs = await self._extract_urls(config, jobs)

        # 4.5 URL 提取失败时逐级 fallback
        url_count = sum(1 for j in jobs if j.get("url", "").strip())
        if url_count == 0 and len(jobs) > 0:
            url_mode = config.get("url_mode", "href")
            print(f"  所有 {len(jobs)} 个卡片的 URL 均为空 (url_mode={url_mode}), 尝试 fallback")

            # Fallback 1: 深层搜索 <a> 标签
            if url_mode == "href":
                jobs = await self._get_urls_deep_href(effective_selector, jobs)
                url_count = sum(1 for j in jobs if j.get("url", "").strip())
                if url_count > 0:
                    print(f"  深层提取命中 {url_count} 个 URL")

            # Fallback 2: 点击卡片捕获导航 URL
            if url_count == 0:
                print("  尝试 click_newtab fallback 提取 URL")
                url_selector = config.get("url_selector")
                wait_ms = config.get("wait_after_click_ms", 2000)
                jobs = await self._get_urls_click_newtab(
                    effective_selector, jobs, wait_ms, url_selector
                )
                url_count = sum(1 for j in jobs if j.get("url", "").strip())
                if url_count > 0:
                    print(f"  click_newtab fallback 命中 {url_count} 个 URL")
                else:
                    print("  所有 fallback 均未找到 URL")

        # 5. 判断是否需要翻页
        if limit > 0 and len(jobs) >= limit:
            print(f"  已满足 limit={limit}，无需翻页")
            jobs = jobs[:limit]
        elif limit == 0 or len(jobs) < limit:
            pagination = config.get("pagination")
            if not pagination:
                pagination = await self._detect_pagination()
            if pagination:
                jobs = await self._paginate(config, pagination, jobs, limit)

        # 截断到 limit
        if limit > 0 and len(jobs) > limit:
            jobs = jobs[:limit]

        # 6. 如果配置了 fetch_detail，获取详情页内容
        if config.get("fetch_detail", False):
            print(f"  开始获取详情页内容...")
            jobs = await self._fetch_all_details(jobs, config)

        return jobs

    async def _extract_urls(self, config: dict, jobs: list[dict]) -> list[dict]:
        """根据 config 的 url_mode 提取所有 job 的详情 URL"""
        card_selector = config["card_selector"]
        url_mode = config.get("url_mode", "href")
        wait_ms = config.get("wait_after_click_ms", 2000)
        url_selector = config.get("url_selector")

        if url_mode == "href":
            jobs = await self._get_urls_href(card_selector, url_selector, jobs)
        elif url_mode == "click_newtab":
            jobs = await self._get_urls_click_newtab(card_selector, jobs, wait_ms, url_selector)
        elif url_mode == "click_navigate":
            jobs = await self._get_urls_click_navigate(card_selector, jobs, wait_ms, url_selector)
        elif url_mode.startswith("attr:"):
            attr_name = url_mode[5:]
            jobs = await self._get_urls_attr(card_selector, attr_name, url_selector, jobs)
        elif url_mode == "js":
            url_js = config.get("url_js", "")
            jobs = await self._get_urls_js(card_selector, url_js, jobs)
        elif url_mode == "none":
            pass
        else:
            print(f"  未知 url_mode: {url_mode}")

        return jobs

    # ── Pagination ────────────────────────────────────────────────

    async def _detect_pagination(self) -> dict | None:
        """启发式检测页面翻页机制，返回 pagination 配置或 None

        检测优先级：load_more > click_next > scroll
        """
        js = """
        (() => {
            function isVisible(el) {
                if (!el) return false;
                const s = window.getComputedStyle(el);
                return s.display !== 'none' && s.visibility !== 'hidden'
                    && s.opacity !== '0' && el.offsetHeight > 0;
            }
            function isDisabled(el) {
                return el.disabled || el.classList.contains('disabled')
                    || el.getAttribute('aria-disabled') === 'true';
            }
            function buildSelector(el) {
                if (el.id) return '#' + el.id;
                if (el.getAttribute('aria-label'))
                    return '[aria-label="' + el.getAttribute('aria-label').replace(/"/g, '\\\\"') + '"]';
                if (el.getAttribute('rel') === 'next')
                    return '[rel="next"]';
                if (el.className && typeof el.className === 'string') {
                    const cls = el.className.trim().split(/\\s+/)
                        .filter(c => c.length > 0 && c.length < 30);
                    if (cls.length > 0)
                        return el.tagName.toLowerCase() + '.' + cls.slice(0, 3).join('.');
                }
                // 兜底：用 data 属性标记元素
                el.setAttribute('data-crawler-pagination', 'true');
                return '[data-crawler-pagination="true"]';
            }

            // 1. 检测 "加载更多" 按钮
            const loadMoreTexts = ['load more', 'show more', '加载更多', '查看更多',
                'more jobs', 'see more', 'view more', 'load more jobs', '更多职位',
                '显示更多'];
            const allClickable = document.querySelectorAll('button, a, [role="button"]');
            for (const el of allClickable) {
                if (!isVisible(el) || isDisabled(el)) continue;
                const text = el.textContent.trim().toLowerCase();
                if (text.length > 50) continue;
                for (const pattern of loadMoreTexts) {
                    if (text.includes(pattern)) {
                        return JSON.stringify({
                            mode: 'load_more',
                            next_selector: buildSelector(el),
                            text: text.substring(0, 30)
                        });
                    }
                }
            }

            // 2. 检测 "下一页" 按钮
            const nextTexts = ['next', '下一页', '›', '»', '→', '>>', 'next page'];
            const nextAriaLabels = ['next page', 'go to next page', 'next', '下一页'];
            const nextClasses = ['next', 'pagination-next', 'pager-next', 'page-next'];

            for (const el of allClickable) {
                if (!isVisible(el) || isDisabled(el)) continue;
                const text = el.textContent.trim().toLowerCase();
                const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
                const rel = (el.getAttribute('rel') || '').toLowerCase();

                let matched = false;
                // 文本匹配（短文本才匹配，避免误触）
                if (text.length <= 15) {
                    for (const p of nextTexts) {
                        if (text === p || text.includes(p)) { matched = true; break; }
                    }
                }
                // aria-label 匹配
                if (!matched) {
                    for (const p of nextAriaLabels) {
                        if (ariaLabel.includes(p)) { matched = true; break; }
                    }
                }
                // class / rel 匹配
                if (!matched) {
                    for (const p of nextClasses) {
                        if (className.includes(p) || rel === 'next') { matched = true; break; }
                    }
                }

                if (matched) {
                    return JSON.stringify({
                        mode: 'click_next',
                        next_selector: buildSelector(el),
                        text: text.substring(0, 30)
                    });
                }
            }

            return JSON.stringify(null);
        })()
        """
        raw = await self.browser.eval_js(js)
        result = _parse_json(raw)
        if result:
            print(f"  检测到翻页: {result['mode']} -> {result.get('next_selector', '')} "
                  f"(\"{result.get('text', '')}\")")
        return result

    async def _paginate(
        self, config: dict, pagination: dict,
        current_jobs: list[dict], limit: int
    ) -> list[dict]:
        """执行翻页循环，收集所有页面的职位

        翻页持续进行直到：
        - 达到 limit 数量
        - 翻页失败（按钮不存在/disabled/点击无效）
        - 无新数据（去重后为空）

        Args:
            config: 站点配置
            pagination: 翻页配置 {mode, next_selector, wait_ms}
            current_jobs: 第一页已提取的职位（含 URL）
            limit: 目标数量，0 不限

        Returns:
            合并后的所有职位列表
        """
        mode = pagination["mode"]
        next_selector = pagination.get("next_selector", "")
        wait_ms = pagination.get("wait_ms", 2000)
        card_selector = config["card_selector"]
        fields = config["fields"]

        all_jobs = list(current_jobs)
        seen_titles = {j.get("title", "") for j in all_jobs}

        print(f"  开始翻页 (mode={mode})")

        page = 1
        while True:
            page += 1
            if limit > 0 and len(all_jobs) >= limit:
                break

            try:
                if mode == "click_next":
                    new_jobs = await self._paginate_click_next(
                        config, next_selector, wait_ms, card_selector, fields, seen_titles
                    )
                elif mode == "load_more":
                    new_jobs = await self._paginate_load_more(
                        config, next_selector, wait_ms, card_selector, fields, seen_titles
                    )
                elif mode == "scroll":
                    new_jobs = await self._paginate_scroll(
                        config, wait_ms, card_selector, fields, seen_titles
                    )
                else:
                    print(f"  未知翻页模式: {mode}")
                    break

                if not new_jobs:
                    print(f"  第 {page} 页: 无新数据，停止翻页")
                    break

                all_jobs.extend(new_jobs)
                for j in new_jobs:
                    seen_titles.add(j.get("title", ""))

                print(f"  第 {page} 页: +{len(new_jobs)} 个职位 (累计 {len(all_jobs)})")

            except Exception as e:
                print(f"  第 {page} 页翻页失败: {e}，停止翻页")
                break

        return all_jobs

    async def _paginate_click_next(
        self, config: dict, next_selector: str, wait_ms: int,
        card_selector: str, fields: dict, seen_titles: set
    ) -> list[dict]:
        """click_next 翻页：点击下一页按钮，提取新页面的卡片+URL"""
        # 检查下一页按钮是否存在且可用
        escaped = _escape_for_js(next_selector)
        check_js = f"""
        (() => {{
            const el = document.querySelector('{escaped}');
            if (!el) return JSON.stringify({{exists: false}});
            const s = window.getComputedStyle(el);
            const visible = s.display !== 'none' && s.visibility !== 'hidden' && el.offsetHeight > 0;
            const disabled = el.disabled || el.classList.contains('disabled')
                || el.getAttribute('aria-disabled') === 'true';
            return JSON.stringify({{exists: true, visible, disabled}});
        }})()
        """
        raw = await self.browser.eval_js(check_js)
        info = _parse_json(raw)
        if not info.get("exists") or not info.get("visible") or info.get("disabled"):
            return []

        # 点击下一页
        await self.browser.click(next_selector)
        await self.browser.wait_ms(wait_ms)
        await self.browser.wait_for_content(timeout_ms=10000)

        # 提取新页面的卡片
        new_jobs = await self._extract_fields(card_selector, fields)
        if not new_jobs:
            return []

        # 去重
        new_jobs = [j for j in new_jobs if j.get("title", "") not in seen_titles]
        if not new_jobs:
            return []

        # 提取 URL
        new_jobs = await self._extract_urls(config, new_jobs)
        return new_jobs

    async def _paginate_load_more(
        self, config: dict, next_selector: str, wait_ms: int,
        card_selector: str, fields: dict, seen_titles: set
    ) -> list[dict]:
        """load_more 翻页：点击加载更多，提取新增的卡片"""
        escaped = _escape_for_js(next_selector)
        check_js = f"""
        (() => {{
            const el = document.querySelector('{escaped}');
            if (!el) return JSON.stringify({{exists: false}});
            const s = window.getComputedStyle(el);
            const visible = s.display !== 'none' && s.visibility !== 'hidden' && el.offsetHeight > 0;
            const disabled = el.disabled || el.classList.contains('disabled')
                || el.getAttribute('aria-disabled') === 'true';
            return JSON.stringify({{exists: true, visible, disabled}});
        }})()
        """
        raw = await self.browser.eval_js(check_js)
        info = _parse_json(raw)
        if not info.get("exists") or not info.get("visible") or info.get("disabled"):
            return []

        # 滚动到按钮并点击
        scroll_js = f"document.querySelector('{escaped}')?.scrollIntoView({{block: 'center'}})"
        await self.browser.eval_js(scroll_js)
        await self.browser.wait_ms(500)
        await self.browser.click(next_selector)
        await self.browser.wait_ms(wait_ms)

        # 重新提取所有卡片，去重找新增
        all_cards = await self._extract_fields(card_selector, fields)
        new_jobs = [j for j in all_cards if j.get("title", "") not in seen_titles]
        if not new_jobs:
            return []

        # 提取 URL（load_more 模式下所有卡片都在 DOM 中，用 _index 对应）
        new_jobs = await self._extract_urls(config, new_jobs)
        return new_jobs

    async def _paginate_scroll(
        self, config: dict, wait_ms: int,
        card_selector: str, fields: dict, seen_titles: set
    ) -> list[dict]:
        """scroll 翻页：滚动到底部触发加载"""
        await self.browser.scroll(direction="down")
        await self.browser.wait_ms(wait_ms)

        # 重新提取所有卡片，去重找新增
        all_cards = await self._extract_fields(card_selector, fields)
        new_jobs = [j for j in all_cards if j.get("title", "") not in seen_titles]
        if not new_jobs:
            return []

        new_jobs = await self._extract_urls(config, new_jobs)
        return new_jobs

    # ── Pre-actions ──────────────────────────────────────────────

    async def _wait_for_cards(
        self,
        card_selector: str,
        timeout_ms: int = 20000,
        stable_rounds: int = 2,
    ) -> int:
        """轮询等待 card_selector 匹配的 DOM 元素数量稳定。

        策略：元素未出现时每 500ms 检测；出现后每 300ms 检测稳定性。
        返回最终检测到的卡片数。超时后返回当前数量（可能为 0）。
        """
        escaped = _escape_for_js(card_selector)
        js = f"document.querySelectorAll('{escaped}').length"

        elapsed = 0
        last_count = 0
        stable = 0

        while elapsed < timeout_ms:
            try:
                page = await self.browser._ensure_browser()
                count = await page.evaluate(js)
            except Exception:
                count = 0

            if count > 0 and count == last_count:
                stable += 1
                if stable >= stable_rounds:
                    print(f"  卡片元素已稳定: {count} 个 ({elapsed}ms)")
                    return count
            else:
                stable = 0

            last_count = count
            # 未发现元素时间隔长一些，发现后快速确认稳定
            poll = 300 if count > 0 else 500
            await asyncio.sleep(poll / 1000)
            elapsed += poll

        print(f"  等待卡片超时 ({timeout_ms}ms), 当前数量: {last_count}")
        return last_count

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
        elif act == "dismiss_popup":
            print("  尝试关闭弹窗...")
            result = await self.browser.dismiss_popup()
            if result:
                print("  弹窗已关闭")
        else:
            print(f"  未知操作: {act}")

    # ── Field extraction ─────────────────────────────────────────

    async def _extract_fields(self, card_selector: str, fields: dict) -> list[dict]:
        """用一次 JS 调用提取所有卡片的字段数据"""
        fields_js = _build_fields_js(fields)
        escaped_selector = _escape_for_js(card_selector)

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

    async def _get_urls_deep_href(self, card_selector: str, jobs: list[dict]) -> list[dict]:
        """深层搜索卡片内所有 <a> 标签，取第一个有效 href。"""
        escaped_card = _escape_for_js(card_selector)
        js = f"""
        (() => {{
            const cards = document.querySelectorAll('{escaped_card}');
            return JSON.stringify(Array.from(cards).map(card => {{
                // 先检查卡片自身
                if (card.tagName === 'A' && card.href) return card.href;
                // 搜索所有后代 <a>
                const links = card.querySelectorAll('a[href]');
                for (const a of links) {{
                    const href = a.href || a.getAttribute('href') || '';
                    if (href && href !== '#' && !href.startsWith('javascript:'))
                        return href;
                }}
                // 检查 data 属性中的 URL
                for (const attr of card.attributes) {{
                    if (attr.value && attr.value.startsWith('/') && attr.value.length > 1)
                        return new URL(attr.value, window.location.origin).href;
                }}
                // 检查父元素是否是 <a>
                if (card.closest('a')?.href) return card.closest('a').href;
                return '';
            }}));
        }})()
        """
        raw = await self.browser.eval_js(js)
        urls = _parse_json(raw) or []

        for job in jobs:
            idx = job.get("_index", 0)
            job["url"] = urls[idx] if idx < len(urls) else ""
        return jobs

    async def _get_urls_href(self, card_selector: str, url_selector: str | None, jobs: list[dict]) -> list[dict]:
        """从 href 属性提取 URL"""
        escaped_card = _escape_for_js(card_selector)
        if url_selector:
            escaped_url = _escape_for_js(url_selector)
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

        for job in jobs:
            idx = job.get("_index", 0)
            job["url"] = urls[idx] if idx < len(urls) else ""
        return jobs

    async def _get_urls_attr(self, card_selector: str, attr_name: str, url_selector: str | None, jobs: list[dict]) -> list[dict]:
        """从指定属性提取 URL"""
        escaped_card = _escape_for_js(card_selector)
        escaped_attr = _escape_for_js(attr_name)
        if url_selector:
            escaped_url = _escape_for_js(url_selector)
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

        for job in jobs:
            idx = job.get("_index", 0)
            job["url"] = urls[idx] if idx < len(urls) else ""
        return jobs

    async def _get_urls_js(self, card_selector: str, url_js: str, jobs: list[dict]) -> list[dict]:
        """用自定义 JS 表达式从每个卡片提取 URL

        url_js 中可用变量: card (当前卡片元素), index (卡片索引)
        表达式应返回一个 URL 字符串。
        """
        escaped_card = _escape_for_js(card_selector)
        js = f"""
        (() => {{
            const cards = document.querySelectorAll('{escaped_card}');
            return JSON.stringify(Array.from(cards).map((card, index) => {{
                try {{
                    return {url_js};
                }} catch(e) {{
                    return '';
                }}
            }}));
        }})()
        """
        raw = await self.browser.eval_js(js)
        urls = _parse_json(raw)

        for job in jobs:
            idx = job.get("_index", 0)
            job["url"] = urls[idx] if idx < len(urls) else ""
        return jobs

    def _parse_click_result(self, raw: str) -> dict:
        """解析 JS 返回的 JSON 结果"""
        try:
            result = _parse_json(raw)
            if isinstance(result, dict):
                return result
        except Exception:
            pass
        return {"status": "unknown"}

    async def _click_card_target(self, card_selector: str, index: int, url_selector: str | None = None) -> dict:
        """标记第 index 个卡片，用 Playwright 点击。

        如果有 url_selector 且初始不可见，先点击卡片展开，再点击 url_selector。
        返回 {status, matched, tag, text} 或 {status: 'not_found'}。
        """
        import asyncio
        escaped = card_selector.replace('"', '\\"')

        # Step 1: 标记卡片并滚动到可见
        mark_js = f"""
        (() => {{
            const old = document.querySelector('[data-crawler-click-target]');
            if (old) old.removeAttribute('data-crawler-click-target');
            const cards = document.querySelectorAll("{escaped}");
            if (cards.length <= {index}) return JSON.stringify({{status: 'not_found'}});
            const card = cards[{index}];
            card.setAttribute('data-crawler-click-target', 'true');
            card.scrollIntoView({{block: 'center'}});
            return JSON.stringify({{status: 'ok'}});
        }})()
        """
        raw = await self.browser.eval_js(mark_js)
        info = self._parse_click_result(raw)
        if info.get("status") != "ok":
            return info

        # Step 2: 如果有 url_selector，检查是否可见
        if url_selector:
            escaped_url = url_selector.replace('"', '\\"')
            vis_js = f"""
            (() => {{
                const card = document.querySelector('[data-crawler-click-target]');
                const btn = card.querySelector("{escaped_url}");
                if (!btn) return JSON.stringify({{visible: false, found: false}});
                const s = window.getComputedStyle(btn);
                const visible = s.visibility !== 'hidden' && s.display !== 'none'
                    && s.opacity !== '0' && btn.getBoundingClientRect().height > 0;
                return JSON.stringify({{visible, found: true}});
            }})()
            """
            vis_raw = await self.browser.eval_js(vis_js)
            vis_info = self._parse_click_result(vis_raw)

            if vis_info.get("found") and not vis_info.get("visible"):
                # 按钮存在但不可见 → 先点击卡片展开
                try:
                    await asyncio.wait_for(
                        self.browser.click("[data-crawler-click-target]"),
                        timeout=10
                    )
                except (asyncio.TimeoutError, Exception):
                    pass
                await self.browser.wait_ms(1000)

                # 标记 url_selector 按钮
                mark_btn_js = f"""
                (() => {{
                    const card = document.querySelector('[data-crawler-click-target]');
                    card.removeAttribute('data-crawler-click-target');
                    const btn = card.querySelector("{escaped_url}");
                    if (!btn) return JSON.stringify({{status: 'not_found'}});
                    btn.setAttribute('data-crawler-click-target', 'true');
                    const s = window.getComputedStyle(btn);
                    return JSON.stringify({{
                        status: 'ok', matched: 'url_selector_after_expand',
                        tag: btn.tagName,
                        text: btn.textContent?.trim()?.substring(0, 30) || '',
                        visible: s.visibility !== 'hidden'
                    }});
                }})()
                """
                raw2 = await self.browser.eval_js(mark_btn_js)
                btn_info = self._parse_click_result(raw2)

                if btn_info.get("visible"):
                    # 按钮现在可见了，点击它
                    try:
                        await asyncio.wait_for(
                            self.browser.click("[data-crawler-click-target]"),
                            timeout=10
                        )
                    except (asyncio.TimeoutError, Exception) as e:
                        print(f"      按钮点击超时: {e}")
                    return btn_info

                # 按钮展开后还是不可见，卡片已经被点击过了，返回卡片点击结果
                return {"status": "ok", "matched": "card", "tag": "DIV", "text": ""}

            elif vis_info.get("found") and vis_info.get("visible"):
                # 按钮直接可见，标记按钮并点击
                mark_btn_js = f"""
                (() => {{
                    const card = document.querySelector('[data-crawler-click-target]');
                    card.removeAttribute('data-crawler-click-target');
                    const btn = card.querySelector("{escaped_url}");
                    btn.setAttribute('data-crawler-click-target', 'true');
                    return JSON.stringify({{
                        status: 'ok', matched: 'url_selector',
                        tag: btn.tagName,
                        text: btn.textContent?.trim()?.substring(0, 30) || ''
                    }});
                }})()
                """
                raw2 = await self.browser.eval_js(mark_btn_js)
                btn_info = self._parse_click_result(raw2)
                try:
                    await asyncio.wait_for(
                        self.browser.click("[data-crawler-click-target]"),
                        timeout=10
                    )
                except (asyncio.TimeoutError, Exception) as e:
                    print(f"      按钮点击超时: {e}")
                return btn_info

        # 没有 url_selector 或 url_selector 不存在 → 智能查找点击目标
        # 优先级：带 href 的 <a> → 卡片本身（直接点击中心）
        # 不点击无 href 的 <a>，因为在 SPA 中可能触发展开而非跳转
        find_js = f"""
        (() => {{
            const card = document.querySelector('[data-crawler-click-target]');
            // 找带 href 的 <a>（真正的链接）
            const links = card.querySelectorAll('a[href]');
            for (const a of links) {{
                const href = a.getAttribute('href') || '';
                if (href && href !== '#' && href !== 'javascript:void(0)') {{
                    card.removeAttribute('data-crawler-click-target');
                    a.setAttribute('data-crawler-click-target', 'true');
                    return JSON.stringify({{status: 'ok', matched: 'a_href', tag: 'A', text: a.textContent?.trim()?.substring(0, 30) || ''}});
                }}
            }}
            // 没有有效链接，直接点击卡片本身
            return JSON.stringify({{status: 'ok', matched: 'card', tag: card.tagName, text: ''}});
        }})()
        """
        raw3 = await self.browser.eval_js(find_js)
        click_info = self._parse_click_result(raw3)

        try:
            await asyncio.wait_for(
                self.browser.click("[data-crawler-click-target]"),
                timeout=10
            )
        except (asyncio.TimeoutError, Exception) as e:
            print(f"      点击超时: {e}")

        return click_info

    async def _get_urls_click_newtab(self, card_selector: str, jobs: list[dict], wait_ms: int, url_selector: str | None = None) -> list[dict]:
        """逐个点击卡片，从新 tab 获取 URL。

        回退链：url_selector 点击 → 卡片本身点击 → href 属性提取
        """
        list_url = await self.browser.get_url()
        fallback_to_href = False
        # 如果 url_selector 点击无效，降级为直接点击卡片
        effective_url_selector = url_selector

        for i, job in enumerate(jobs):
            if fallback_to_href:
                break

            card_index = job.get("_index", i)
            print(f"    [{i+1}/{len(jobs)}] 点击: {job.get('title', '?')[:40]}...")

            tabs_before = await self.browser.get_tabs()

            click_info = await self._click_card_target(card_selector, card_index, effective_url_selector)
            if click_info.get("status") == "not_found":
                print(f"      卡片不存在，跳过")
                job["url"] = ""
                continue
            if click_info.get("matched"):
                print(f"      点击目标: {click_info['matched']} <{click_info.get('tag', '?')}> {click_info.get('text', '')[:20]}")

            await self.browser.wait_ms(wait_ms)

            detail_url, _ = await self._detect_navigation(list_url, tabs_before, card_selector)
            if detail_url:
                job["url"] = detail_url
            elif i == 0:
                # 第一个卡片未跳转
                if effective_url_selector:
                    # url_selector 无效，降级为直接点击卡片本身
                    # 先 reload 恢复 DOM 状态（url_selector 点击可能展开/修改了卡片）
                    print(f"      (未跳转) url_selector 无效，reload 后尝试直接点击卡片...")
                    effective_url_selector = None
                    await self.browser.reload()
                    await self.browser.wait_for_content(timeout_ms=10000)

                    tabs_before2 = await self.browser.get_tabs()
                    click_info2 = await self._click_card_target(card_selector, card_index, None)
                    if click_info2.get("matched"):
                        print(f"      点击目标: {click_info2['matched']} <{click_info2.get('tag', '?')}> {click_info2.get('text', '')[:20]}")
                    await self.browser.wait_ms(wait_ms)

                    detail_url2, _ = await self._detect_navigation(list_url, tabs_before2, card_selector)
                    if detail_url2:
                        job["url"] = detail_url2
                    else:
                        print(f"      (未跳转) 点击卡片也无效，回退到 href 提取")
                        fallback_to_href = True
                else:
                    print(f"      (未跳转) 点击无效，回退到 href 提取")
                    fallback_to_href = True
            else:
                job["url"] = ""
                print(f"      (未跳转)")

        if fallback_to_href:
            print(f"    回退: 从 href 属性提取 URL")
            jobs = await self._get_urls_href(card_selector, url_selector, jobs)

        return jobs

    async def _detect_navigation(self, list_url: str, tabs_before: list[str], card_selector: str = "") -> tuple[str | None, str]:
        """检测点击后是否发生了导航（新 tab 或 URL 变化）

        Returns:
            (detail_url, nav_type) 二元组
            - detail_url: 详情页 URL 或 None
            - nav_type: "newtab" | "spa" | "none"
        """
        tabs_after = await self.browser.get_tabs()
        if len(tabs_after) > len(tabs_before):
            # 新 tab 打开了
            await self.browser.switch_tab(len(tabs_after) - 1)
            await self.browser.wait_ms(1000)
            detail_url = await self.browser.get_url()
            print(f"      -> {detail_url}")
            await self.browser.close_tab()
            await self.browser.switch_tab(0)
            await self.browser.wait_ms(500)
            return detail_url, "newtab"

        # 检测 URL 变化（SPA 路由跳转）
        current_url = await self.browser.get_url()
        if current_url == list_url:
            await self.browser.wait_ms(1000)
            current_url = await self.browser.get_url()

        if current_url != list_url:
            print(f"      (页内跳转) -> {current_url}")
            # SPA 站点用 navigate 回列表页（比 go_back 更可靠）
            await self.browser.navigate(list_url)
            await self.browser.wait_for_content(timeout_ms=10000)
            # 等待卡片选择器出现
            if card_selector:
                found = await self._wait_for_selector(card_selector, timeout_ms=5000)
                if not found:
                    print(f"      警告: 返回列表页后未找到卡片 ({card_selector})")
            return current_url, "spa"

        return None, "none"

    async def _wait_for_selector(self, selector: str, timeout_ms: int = 5000) -> bool:
        """等待指定 CSS 选择器的元素出现在 DOM 中

        Returns:
            True 如果找到，False 如果超时
        """
        escaped = _escape_for_js(selector)
        poll_interval = 500
        elapsed = 0
        while elapsed < timeout_ms:
            js = f"document.querySelectorAll('{escaped}').length"
            try:
                raw = await self.browser.eval_js(js)
                count = int(raw)
                if count > 0:
                    return True
            except Exception:
                pass
            await self.browser.wait_ms(poll_interval)
            elapsed += poll_interval
        return False

    async def _get_urls_click_navigate(self, card_selector: str, jobs: list[dict], wait_ms: int, url_selector: str | None = None) -> list[dict]:
        """逐个点击卡片，从 URL 变化获取详情链接"""
        list_url = await self.browser.get_url()

        for i, job in enumerate(jobs):
            card_index = job.get("_index", i)
            print(f"    [{i+1}/{len(jobs)}] 点击: {job.get('title', '?')[:40]}...")

            click_info = await self._click_card_target(card_selector, card_index, url_selector)
            if click_info.get("status") == "not_found":
                job["url"] = ""
                continue
            if click_info.get("matched"):
                print(f"      点击目标: {click_info['matched']} <{click_info.get('tag', '?')}> {click_info.get('text', '')[:20]}")

            await self.browser.wait_ms(wait_ms)

            detail_url = await self.browser.get_url()
            if detail_url and detail_url != list_url:
                job["url"] = detail_url
                print(f"      -> {detail_url}")

                # 返回列表页（用 navigate 比 go_back 更可靠，尤其对 SPA）
                await self.browser.navigate(list_url)
                await self.browser.wait_for_content(timeout_ms=10000)
                if card_selector:
                    found = await self._wait_for_selector(card_selector, timeout_ms=5000)
                    if not found:
                        print(f"      警告: 返回列表页后未找到卡片，停止提取")
                        break
            else:
                job["url"] = ""
                print(f"      (未跳转)")

        return jobs

    # ── Detail page fetching ──────────────────────────────────────

    async def _fetch_detail_content(self, job: dict, config: dict, base_url: str) -> None:
        """导航到详情页并提取内容

        支持两种模式：
        1. 结构化模式：config 中有 detail.fields → 按字段提取，写入 job["detail_fields"]
        2. 整块模式（兼容旧配置）：无 detail.fields → 整块文本，写入 job["detail_content"]
        """
        raw_url = job.get("url", "")

        # 过滤无效 URL
        if not raw_url or raw_url in ("#", "javascript:void(0)", "javascript:;"):
            return

        # 处理相对 URL
        if not raw_url.startswith(("http://", "https://")):
            raw_url = urljoin(base_url, raw_url)

        # 过滤掉与列表页相同的 URL
        if raw_url == base_url:
            return

        detail_config = config.get("detail", {})
        detail_fields = detail_config.get("fields", {})
        detail_wait_ms = detail_config.get("wait_ms") or config.get("detail_wait_ms", 2000)
        container_selector = detail_config.get("container_selector") or config.get("detail_selector", "body")

        try:
            await self.browser.navigate(raw_url)
            await self.browser.wait_ms(detail_wait_ms)

            # 执行详情页预操作
            for action in detail_config.get("pre_actions", []):
                await self._run_action(action)

            if detail_fields:
                # 结构化字段提取模式
                job["detail_fields"] = await self._extract_detail_fields(
                    container_selector, detail_fields
                )
            else:
                # 兼容旧配置：整块文本提取
                detail_format = config.get("detail_format", "text")
                escaped_selector = _escape_for_js(container_selector)
                if detail_format == "html":
                    extract_expr = "clone.innerHTML"
                else:
                    extract_expr = "clone.innerText.trim()"

                js = f"""
                (() => {{
                    let el = document.querySelector('{escaped_selector}') || document.body;
                    const clone = el.cloneNode(true);
                    clone.querySelectorAll('script,style,nav,footer,header,iframe,[role="navigation"],[role="banner"],[role="contentinfo"]').forEach(s => s.remove());
                    const content = {extract_expr};
                    return content.length > 50000 ? content.substring(0, 50000) + '...(truncated)' : content;
                }})()
                """
                content = await self.browser.eval_js(js)
                if isinstance(content, str):
                    job["detail_content"] = content
                else:
                    job["detail_content"] = str(content)
        except Exception as e:
            job["detail_content"] = ""
            job["detail_error"] = str(e)
            print(f"      详情获取失败: {e}")

    async def _extract_detail_fields(self, container_selector: str, fields: dict) -> dict:
        """从详情页按字段提取结构化数据

        与列表页 _extract_fields 不同：
        - 不是提取多个卡片，而是从单个容器中提取字段
        - 移除 script/style 等噪音后取文本
        """
        escaped_container = _escape_for_js(container_selector)
        parts = []
        for name, selector in fields.items():
            escaped = _escape_for_js(selector)
            parts.append(
                f"    {name}: (() => {{"
                f" const el = container.querySelector('{escaped}');"
                f" if (!el) return '';"
                f" const clone = el.cloneNode(true);"
                f" clone.querySelectorAll('script,style').forEach(s => s.remove());"
                f" return clone.innerText.trim();"
                f" }})()"
            )
        fields_js = ",\n".join(parts)

        js = f"""
        (() => {{
            const container = document.querySelector('{escaped_container}') || document.body;
            return JSON.stringify({{
{fields_js}
            }});
        }})()
        """
        raw = await self.browser.eval_js(js)
        return _parse_json(raw)

    async def _fetch_all_details(self, jobs: list[dict], config: dict) -> list[dict]:
        """遍历所有职位，逐个获取详情页内容"""
        base_url = await self.browser.get_url()
        valid_jobs = [j for j in jobs if j.get("url", "").strip()]
        total = len(valid_jobs)

        for i, job in enumerate(valid_jobs):
            title = job.get("title", "?")[:40]
            print(f"  获取详情 [{i+1}/{total}] {title}...")
            await self._fetch_detail_content(job, config, base_url)

        return jobs
