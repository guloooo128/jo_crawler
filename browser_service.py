"""Playwright-based browser service for browser automation."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Optional

from playwright.async_api import async_playwright, Browser, BrowserContext, Page, Playwright

logger = logging.getLogger(__name__)


class BrowserService:
    """Wraps Playwright for browser automation.

    All browser operations are executed through Playwright's async API.
    The browser is lazily initialized on first use.
    """

    def __init__(
        self,
        session: str = "default",
        headless: bool = True,
        cdp_url: Optional[str] = None,
        timeout: int = 60000,
    ):
        self.headless = headless
        self.cdp_url = cdp_url
        self.timeout = timeout
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        # Cache for @ref click support: ref_id -> {role, name}
        self._refs_cache: dict[str, dict] = {}

    async def _ensure_browser(self) -> Page:
        """Lazily initialize Playwright browser and return the active page."""
        if self._page and not self._page.is_closed():
            return self._page

        if not self._playwright:
            self._playwright = await async_playwright().start()

        if not self._browser or not self._browser.is_connected():
            if self.cdp_url:
                self._browser = await self._playwright.chromium.connect_over_cdp(self.cdp_url)
            else:
                self._browser = await self._playwright.chromium.launch(
                    headless=self.headless,
                )

        if not self._context:
            if self._browser.contexts:
                self._context = self._browser.contexts[0]
            else:
                self._context = await self._browser.new_context(
                    viewport={"width": 1280, "height": 800},
                )

        if not self._context.pages:
            self._page = await self._context.new_page()
        else:
            self._page = self._context.pages[-1]

        self._page.set_default_timeout(self.timeout)
        return self._page

    # ── Navigation ──────────────────────────────────────────────────

    async def navigate(self, url: str) -> None:
        """Navigate to a URL."""
        page = await self._ensure_browser()
        await page.goto(url, wait_until="domcontentloaded")

    async def navigate_with_retry(self, url: str, max_retries: int = 2) -> None:
        """Navigate with retry on failure."""
        last_error = None
        for attempt in range(max_retries + 1):
            try:
                await self.navigate(url)
                return
            except Exception as e:
                last_error = e
                if attempt < max_retries:
                    logger.warning(f"Navigation attempt {attempt + 1} failed, retrying: {e}")
                    await asyncio.sleep(2)
        raise last_error  # type: ignore

    async def go_back(self) -> None:
        page = await self._ensure_browser()
        await page.go_back()

    async def reload(self) -> None:
        page = await self._ensure_browser()
        await page.reload()

    # ── Snapshot & Info ─────────────────────────────────────────────

    async def get_snapshot(
        self,
        interactive: bool = True,
        max_depth: Optional[int] = 5,
        compact: bool = False,
    ) -> dict[str, Any]:
        """Get accessibility tree snapshot.

        Returns:
            {"tree": str, "refs": dict} where refs maps ref IDs to element info.
        """
        page = await self._ensure_browser()
        snapshot = await page.accessibility.snapshot(interesting_only=interactive)

        refs: dict[str, dict] = {}
        tree_lines: list[str] = []
        ref_counter = [0]

        def _walk(node: dict, depth: int = 0):
            if max_depth is not None and depth > max_depth:
                return
            role = node.get("role", "")
            name = node.get("name", "")
            ref_id = str(ref_counter[0])
            ref_counter[0] += 1

            refs[ref_id] = {"role": role, "name": name}
            indent = "  " * depth
            tree_lines.append(f"{indent}[{ref_id}] {role}: {name}")

            for child in node.get("children", []):
                _walk(child, depth + 1)

        if snapshot:
            _walk(snapshot)

        self._refs_cache = refs

        tree_str = "\n".join(tree_lines)
        return {"tree": tree_str, "refs": refs}

    async def get_snapshot_with_retry(
        self,
        interactive: bool = True,
        max_depth: int = 5,
        max_retries: int = 8,
        interval_ms: int = 2000,
        stable_threshold: int = 2,
    ) -> dict[str, Any]:
        """Get snapshot with stability-check retries.

        Polls snapshots until ref count stabilizes for `stable_threshold`
        consecutive attempts.
        """
        last_ref_count = 0
        stable_count = 0
        best_snapshot = None
        best_ref_count = 0
        last_snapshot = None

        logger.info(f"Getting snapshot with retry (max={max_retries}, interval={interval_ms}ms)...")

        for attempt in range(max_retries):
            try:
                snapshot = await self.get_snapshot(interactive=interactive, max_depth=max_depth)
                ref_count = len(snapshot.get("refs", {}))
                tree_len = len(snapshot.get("tree", ""))

                logger.info(f"  snapshot #{attempt + 1}: {ref_count} refs, tree={tree_len} chars")

                if ref_count > best_ref_count:
                    best_snapshot = snapshot
                    best_ref_count = ref_count

                if ref_count > 0 and ref_count <= last_ref_count:
                    stable_count += 1
                else:
                    stable_count = 0

                if stable_count >= stable_threshold and ref_count > 0:
                    logger.info(f"  snapshot stable: {ref_count} refs (stable for {stable_count} polls)")
                    return snapshot

                last_ref_count = ref_count
                last_snapshot = snapshot

            except Exception as e:
                logger.warning(f"  snapshot #{attempt + 1} error: {e}")

            if attempt < max_retries - 1:
                await asyncio.sleep(interval_ms / 1000)

        logger.warning(f"Snapshot retries exhausted, returning best ({best_ref_count} refs)")
        return best_snapshot or last_snapshot or {}

    async def get_url(self) -> str:
        """Get current page URL."""
        page = await self._ensure_browser()
        return page.url

    async def get_title(self) -> str:
        """Get current page title."""
        page = await self._ensure_browser()
        return await page.title()

    async def get_text(self, selector: str = "") -> str:
        """Get text content of an element or the whole page."""
        page = await self._ensure_browser()
        if selector:
            return await page.text_content(selector) or ""
        return await page.evaluate("document.body.innerText")

    async def get_html(self, selector: str = "") -> str:
        """Get HTML content of an element."""
        page = await self._ensure_browser()
        if selector:
            return await page.inner_html(selector)
        return await page.content()

    async def get_attribute(self, selector: str, attr_name: str) -> str:
        """Get an element's attribute value."""
        page = await self._ensure_browser()
        return await page.get_attribute(selector, attr_name) or ""

    # ── Interaction ─────────────────────────────────────────────────

    async def click(self, selector: str) -> None:
        """Click an element (supports @ref notation and CSS selectors)."""
        page = await self._ensure_browser()

        if selector.startswith("@"):
            ref_id = selector[1:]
            ref_info = self._refs_cache.get(ref_id)
            if ref_info:
                role = ref_info.get("role", "")
                name = ref_info.get("name", "")
                if role and name:
                    locator = page.get_by_role(role, name=name)
                    await locator.first.click(timeout=10000)
                    return
            logger.warning(f"Ref {ref_id} not found in cache, falling back to page click")
            return

        await page.click(selector, timeout=10000)

    async def fill(self, selector: str, text: str) -> None:
        """Clear and fill an input field."""
        page = await self._ensure_browser()
        await page.fill(selector, text)

    async def type_text(self, selector: str, text: str) -> None:
        """Type into an element."""
        page = await self._ensure_browser()
        await page.type(selector, text)

    async def press(self, key: str) -> None:
        """Press a keyboard key."""
        page = await self._ensure_browser()
        await page.keyboard.press(key)

    async def hover(self, selector: str) -> None:
        """Hover over an element."""
        page = await self._ensure_browser()
        await page.hover(selector)

    async def select(self, selector: str, value: str) -> None:
        """Select a dropdown option."""
        page = await self._ensure_browser()
        await page.select_option(selector, value)

    # ── Scrolling & Waiting ─────────────────────────────────────────

    async def scroll(self, direction: str = "down", px: Optional[int] = None) -> None:
        """Scroll the page."""
        page = await self._ensure_browser()
        amount = px or 600
        if direction == "up":
            amount = -amount
        await page.evaluate(f"window.scrollBy(0, {amount})")

    async def scroll_into_view(self, selector: str) -> None:
        """Scroll element into view."""
        page = await self._ensure_browser()
        await page.locator(selector).scroll_into_view_if_needed()

    async def scroll_page(self, times: int = 3, delay_ms: int = 800) -> None:
        """Scroll page multiple times to trigger lazy loading."""
        logger.info(f"Scrolling page {times} times (delay={delay_ms}ms)...")
        for i in range(times):
            await self.scroll("down", 600)
            await asyncio.sleep(delay_ms / 1000)
            logger.debug(f"  scroll {i + 1}/{times} done")
        await self.scroll("up", times * 600)
        logger.info("Scroll complete, returned to top")

    async def wait(self, target: str) -> None:
        """Wait for an element selector or milliseconds."""
        page = await self._ensure_browser()
        if target.isdigit():
            await page.wait_for_timeout(int(target))
        else:
            await page.wait_for_selector(target)

    async def wait_ms(self, ms: int) -> None:
        """Wait for specified milliseconds."""
        page = await self._ensure_browser()
        await page.wait_for_timeout(ms)

    async def wait_for_content(
        self,
        timeout_ms: int = 20000,
        min_elements: int = 5,
        poll_interval_ms: int = 1500,
        stable_threshold: int = 2,
    ) -> bool:
        """Wait until page has enough interactive elements and DOM is stable."""
        elapsed = 0
        last_count = 0
        stable_count = 0

        logger.info(f"Waiting for content (min={min_elements} elements, timeout={timeout_ms}ms)...")

        while elapsed < timeout_ms:
            try:
                snapshot = await self.get_snapshot(interactive=True)
                ref_count = len(snapshot.get("refs", {}))
                logger.debug(f"  poll: {ref_count} refs (elapsed={elapsed}ms)")

                if ref_count >= min_elements:
                    if ref_count <= last_count:
                        stable_count += 1
                    else:
                        stable_count = 0

                    if stable_count >= stable_threshold:
                        logger.info(f"Content ready: {ref_count} refs (stable for {stable_count} polls)")
                        return True

                last_count = ref_count
            except Exception as e:
                logger.debug(f"  poll error: {e}")

            await asyncio.sleep(poll_interval_ms / 1000)
            elapsed += poll_interval_ms

        logger.warning(f"Content wait timed out after {timeout_ms}ms (last count: {last_count})")
        return last_count >= min_elements

    # ── Screenshots & Media ─────────────────────────────────────────

    async def screenshot(self, path: str, full_page: bool = False) -> None:
        """Take a screenshot."""
        page = await self._ensure_browser()
        await page.screenshot(path=path, full_page=full_page)

    # ── JavaScript ──────────────────────────────────────────────────

    async def eval_js(self, code: str) -> str:
        """Execute JavaScript and return result as string."""
        page = await self._ensure_browser()
        result = await page.evaluate(code)
        if isinstance(result, str):
            return result
        return json.dumps(result)

    # ── Cookie & Storage ────────────────────────────────────────────

    async def dismiss_cookie_banner(self) -> bool:
        """Try to dismiss common cookie/privacy banners.

        Returns True if a banner was found and dismissed.
        """
        try:
            return await asyncio.wait_for(
                self._dismiss_cookie_banner_inner(), timeout=10
            )
        except asyncio.TimeoutError:
            logger.warning("Cookie banner dismissal timed out (10s)")
            return False
        except Exception as e:
            logger.debug(f"Cookie banner dismissal failed: {e}")
            return False

    async def _dismiss_cookie_banner_inner(self) -> bool:
        """Inner implementation for cookie banner dismissal."""
        snapshot = await self.get_snapshot(interactive=True)
        refs = snapshot.get("refs", {})

        cookie_patterns = [
            r"accept.*cookie", r"accept all", r"agree.*cookie",
            r"allow.*cookie", r"cookie.*accept", r"cookie.*agree",
            r"got it", r"i understand", r"dismiss",
        ]

        for ref_id, ref_info in refs.items():
            role = ref_info.get("role", "")
            name = (ref_info.get("name", "") or "").lower()
            if role == "button" and name:
                for pattern in cookie_patterns:
                    if re.search(pattern, name, re.IGNORECASE):
                        logger.info(f"Cookie banner: clicking '{name}' (@{ref_id})")
                        await self.click(f"@{ref_id}")
                        await asyncio.sleep(1)
                        return True

        logger.debug(f"No cookie banner found in {len(refs)} refs")
        return False

    async def dismiss_popup(self) -> bool:
        """尝试关闭页面上的弹窗/遮罩层（通用版）

        Returns True if a popup was found and dismissed.
        """
        try:
            return await asyncio.wait_for(
                self._dismiss_popup_inner(), timeout=15
            )
        except asyncio.TimeoutError:
            logger.warning("Popup dismissal timed out (15s)")
            return False
        except Exception as e:
            logger.debug(f"Popup dismissal failed: {e}")
            return False

    async def _dismiss_popup_inner(self) -> bool:
        dismissed = await self.dismiss_cookie_banner()
        if dismissed:
            return True

        close_js = """
        (() => {
            function isVisible(el) {
                const s = window.getComputedStyle(el);
                return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
            }

            function findCloseBtn(container) {
                const closeBtn = container.querySelector(
                    '[class*="close"], [class*="Close"], ' +
                    '[aria-label*="close"], [aria-label*="关闭"], [aria-label*="Close"], ' +
                    '.close-btn, .closeBtn, .close_btn'
                );
                if (closeBtn && isVisible(closeBtn)) return {el: closeBtn, method: 'close_class'};

                const icons = container.querySelectorAll('span, i, svg, button');
                for (const icon of icons) {
                    const text = (icon.textContent || '').trim();
                    const rect = icon.getBoundingClientRect();
                    if (['×', '✕', '✖'].includes(text) && rect.width < 60 && rect.height < 60) {
                        return {el: icon, method: 'close_icon'};
                    }
                }

                const allBtns = [...container.querySelectorAll(
                    'button, [role="button"], ' +
                    '[class*="button"], [class*="Button"], [class*="btn"], [class*="Btn"]'
                )].filter(b => {
                    if (!isVisible(b)) return false;
                    const r = b.getBoundingClientRect();
                    return r.width > 20 && r.height > 10;
                });

                if (allBtns.length === 1) {
                    return {el: allBtns[0], method: 'sole_button'};
                }

                if (allBtns.length >= 2) {
                    return {el: allBtns[allBtns.length - 1], method: 'last_button'};
                }

                return null;
            }

            const modals = document.querySelectorAll(
                '[role="dialog"], [class*="modal"], [class*="Modal"], ' +
                '[class*="popup"], [class*="Popup"], [class*="dialog"], [class*="Dialog"]'
            );

            for (const modal of modals) {
                if (!isVisible(modal)) continue;
                const style = window.getComputedStyle(modal);
                const zIndex = parseInt(style.zIndex || '0', 10);
                if (style.position === 'static' && zIndex < 10) continue;
                const rect = modal.getBoundingClientRect();
                if (rect.width < 100 || rect.height < 50) continue;

                const result = findCloseBtn(modal);
                if (result) {
                    result.el.click();
                    const cls = typeof modal.className === 'string' ? modal.className : '';
                    return JSON.stringify({found: true, method: result.method, cls: cls.substring(0, 50), text: (result.el.textContent || '').trim().substring(0, 30)});
                }
            }

            const candidates = [...document.body.children];
            for (const child of document.body.children) {
                if (child.children) candidates.push(...child.children);
            }
            const fixed = candidates.filter(el => {
                if (el.tagName !== 'DIV' && el.tagName !== 'SECTION') return false;
                const s = window.getComputedStyle(el);
                return (s.position === 'fixed' || s.position === 'absolute')
                    && parseInt(s.zIndex || '0', 10) > 100
                    && el.getBoundingClientRect().width > 200
                    && isVisible(el);
            });
            for (const el of fixed) {
                const result = findCloseBtn(el);
                if (result) {
                    result.el.click();
                    return JSON.stringify({found: true, method: result.method, text: (result.el.textContent || '').trim().substring(0, 20)});
                }
            }

            return JSON.stringify({found: false});
        })()
        """
        raw = await self.eval_js(close_js)
        try:
            result = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(result, str):
                result = json.loads(result)
        except Exception as e:
            logger.debug(f"Failed to parse popup JS result: {raw!r} - {e}")
            result = {}

        if result.get("found"):
            logger.info(f"Popup dismissed: {result.get('method')} - {result.get('text', result.get('cls', ''))}")
            await asyncio.sleep(1)
            return True

        return False

    # ── Tab management ──────────────────────────────────────────────

    async def get_tabs(self) -> list[str]:
        """获取所有标签页列表"""
        try:
            await self._ensure_browser()
            if not self._context:
                return []
            pages = self._context.pages
            result = []
            for i, p in enumerate(pages):
                try:
                    title = await p.title()
                    result.append(f"{i}: {p.url} - {title}")
                except Exception:
                    result.append(f"{i}: {p.url}")
            return result
        except Exception as e:
            logger.warning(f"Failed to get tabs: {e}")
            return []

    async def switch_tab(self, index: int) -> None:
        """切换到指定索引的标签页"""
        await self._ensure_browser()
        if not self._context:
            return
        pages = self._context.pages
        if 0 <= index < len(pages):
            self._page = pages[index]
            await self._page.bring_to_front()

    async def close_tab(self) -> None:
        """关闭当前标签页"""
        if self._page and not self._page.is_closed():
            await self._page.close()
            # Switch to last remaining page
            if self._context and self._context.pages:
                self._page = self._context.pages[-1]
            else:
                self._page = None

    async def click_with_mouseevents(self, selector: str, index: int = 0) -> str:
        """使用完整鼠标事件序列点击元素（mousedown → mouseup → click）"""
        click_js = f"""
        (() => {{
            const el = document.querySelectorAll("{selector}")[{index}];
            if (!el) return 'not_found';
            const rect = el.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const opts = {{bubbles: true, cancelable: true, view: window, clientX: x, clientY: y}};
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            return 'dispatched';
        }})()
        """
        result = await self.eval_js(click_js)
        return result

    # ── Session management ──────────────────────────────────────────

    async def close(self) -> None:
        """Close the browser session."""
        try:
            if self._page and not self._page.is_closed():
                await self._page.close()
        except Exception:
            pass
        try:
            if self._context:
                await self._context.close()
        except Exception:
            pass
        try:
            if self._browser:
                await self._browser.close()
        except Exception:
            pass
        try:
            if self._playwright:
                await self._playwright.stop()
        except Exception:
            pass
        self._page = None
        self._context = None
        self._browser = None
        self._playwright = None
