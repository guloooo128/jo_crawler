"""从浏览器页面中自动检测职位列表容器并提取精简 DOM

通过 JS 启发式评分找到页面中最可能是职位列表的重复结构容器，
只提取容器 + 前几个子元素的 HTML，供 LLM 分析生成配置。
"""

import json

from browser_service import BrowserService

# 置信度阈值：评分 >= 此值才认为检测成功
MIN_SCORE = 40

# 在浏览器中执行的 JS 启发式检测脚本
_HEURISTIC_JS = """
(() => {
    const candidates = [];
    const allElements = document.querySelectorAll('body *');

    for (const el of allElements) {
        // 排除导航、页头页脚区域
        if (el.closest('nav, footer, header, [role="navigation"], [role="banner"], [role="contentinfo"]')) continue;
        // 排除不可见元素
        if (el.offsetHeight === 0 || el.offsetWidth === 0) continue;

        const children = Array.from(el.children);
        if (children.length < 3) continue;

        // 按标签名分组子元素
        const signatures = {};
        for (const child of children) {
            const sig = child.tagName;
            signatures[sig] = (signatures[sig] || 0) + 1;
        }

        // 找到最多的同类子元素
        const [dominantTag, count] = Object.entries(signatures)
            .sort((a, b) => b[1] - a[1])[0];

        if (count < 3) continue;

        // ── 评分 ──
        let score = 0;

        // 重复子元素数量（log 缩放，最高 50 分）
        score += Math.min(Math.log2(count) * 10, 50);

        // 子元素含 <a> 链接的比例（最高 20 分）
        const dominantChildren = children.filter(c => c.tagName === dominantTag);
        const childrenWithLinks = dominantChildren.filter(c =>
            c.querySelector('a[href]') || (c.tagName === 'A' && c.href)
        ).length;
        score += (childrenWithLinks / dominantChildren.length) * 20;

        // 子元素文字丰富度（最高 25 分）
        const avgTextLen = dominantChildren.reduce((sum, c) =>
            sum + c.textContent.trim().length, 0) / dominantChildren.length;
        if (avgTextLen > 20) score += 15;
        if (avgTextLen > 50) score += 10;

        // 文字太短 → 可能是导航菜单（扣分）
        if (avgTextLen < 15) score -= 20;

        // 容器或子元素的 class 含 job 相关关键词（+15 分）
        const classText = (
            (typeof el.className === 'string' ? el.className : '') + ' ' +
            dominantChildren.map(c => typeof c.className === 'string' ? c.className : '').join(' ')
        ).toLowerCase();
        const jobPatterns = ['job', 'position', 'career', 'vacancy', 'opening', 'posting', 'role', 'listing'];
        for (const pattern of jobPatterns) {
            if (classText.includes(pattern)) { score += 15; break; }
        }

        // DOM 深度惩罚（太深的容器不太可能是主列表）
        let depth = 0;
        let p = el;
        while (p.parentElement) { depth++; p = p.parentElement; }
        if (depth > 15) score -= 10;

        candidates.push({
            element: el,
            score: score,
            childCount: count,
            dominantTag: dominantTag,
            avgTextLen: avgTextLen,
        });
    }

    if (candidates.length === 0) return JSON.stringify(null);

    // 按评分排序，取最高分
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const el = best.element;

    // ── 生成 CSS 选择器 ──
    function buildSelector(node) {
        if (node.id) return '#' + CSS.escape(node.id);
        let path = '';
        let current = node;
        while (current && current !== document.body) {
            let segment = current.tagName.toLowerCase();
            if (current.id) {
                segment = '#' + CSS.escape(current.id);
                path = segment + (path ? ' > ' + path : '');
                break;
            }
            if (current.className && typeof current.className === 'string') {
                // 过滤掉 hash/混淆 class（超过 30 字符或看起来像 hash）
                const classes = current.className.trim().split(/\\s+/)
                    .filter(c => c.length > 0 && c.length < 30 && !/^[a-f0-9]{8}/i.test(c));
                if (classes.length > 0) {
                    segment += '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
                }
            }
            const parent = current.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(current) + 1;
                    segment += ':nth-of-type(' + index + ')';
                }
            }
            path = segment + (path ? ' > ' + path : '');
            current = current.parentElement;
        }
        return path;
    }

    // ── 提取精简 HTML：容器壳 + 前 3 个同类子元素 ──
    const maxChildren = 3;
    const clone = el.cloneNode(false);
    const dominantChildren = Array.from(el.children)
        .filter(c => c.tagName === best.dominantTag);
    for (let i = 0; i < Math.min(maxChildren, dominantChildren.length); i++) {
        clone.appendChild(dominantChildren[i].cloneNode(true));
    }

    return JSON.stringify({
        selector: buildSelector(el),
        child_count: best.childCount,
        child_tag: best.dominantTag.toLowerCase(),
        score: Math.round(best.score * 10) / 10,
        sample_html: clone.outerHTML,
    });
})()
"""


async def find_job_container(browser: BrowserService) -> dict | None:
    """在当前页面中检测职位列表容器

    Returns:
        成功时返回 dict:
            selector: CSS 选择器
            child_count: 同类子元素数量
            child_tag: 子元素标签名
            score: 评分
            sample_html: 容器 + 前 3 个子元素的 HTML
        检测失败返回 None
    """
    raw = await browser.eval_js(_HEURISTIC_JS)

    try:
        result = json.loads(raw)
        # eval_js 可能返回多层编码
        if isinstance(result, str):
            result = json.loads(result)
    except (json.JSONDecodeError, TypeError):
        return None

    if not result:
        return None

    if result.get("score", 0) < MIN_SCORE:
        return None

    return result
