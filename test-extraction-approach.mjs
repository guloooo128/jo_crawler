// 测试不同的数据提取方法
import { BrowserManager } from 'agent-browser/dist/browser.js';

const browser = new BrowserManager();
await browser.launch({ headless: true });

const page = browser.getPage();
await page.goto('https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs/preview/210690325/?keyword=intern', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const snapshot = await browser.getSnapshot({ interactive: true, maxDepth: 3 });
const { tree, refs } = snapshot;

console.log('=== 方法1: 从 tree 字符串用正则提取 ===');
// tree 格式: - link "Job Title • Location" [ref=e11]
const titleMatch1 = tree.match(/link\s+"([^"]+?)\s+•/);
console.log('正则提取标题:', titleMatch1 ? titleMatch1[1] : '未找到');

console.log('\n=== 方法2: 使用 refs 定位后用 getText ===');
// 查找包含关键字的 ref
let targetRef = null;
for (const [ref, info] of Object.entries(refs)) {
  if (info.name && info.name.includes('2027') && info.role === 'link') {
    targetRef = ref;
    break;
  }
}
console.log('找到目标 ref:', targetRef);

if (targetRef) {
  const locator = browser.getLocatorFromRef(targetRef);
  const text = await locator.textContent();
  console.log('使用 getText 提取:', text);
}

console.log('\n=== 方法3: 直接用 Playwright locator ===');
const page2 = browser.getPage();
try {
  // 尝试多种选择器
  const selectors = [
    'h1',
    '.job-title',
    '[role="heading"]',
    'text=2027'
  ];
  
  for (const sel of selectors) {
    try {
      const element = await page2.locator(sel).first();
      if (await element.count() > 0) {
        const text = await element.textContent();
        console.log(`选择器 "${sel}" 找到:`, text?.substring(0, 50));
      }
    } catch (e) {
      // 忽略
    }
  }
} catch (e) {
  console.log('Playwright locator 方法失败:', e.message);
}

console.log('\n=== 方法4: 遍历所有 refs 找最合适的 ===');
const candidates = [];
for (const [ref, info] of Object.entries(refs)) {
  if (info.role === 'link' && info.name && info.name.length > 20) {
    candidates.push({ ref, name: info.name });
  }
}
console.log('候选标题 (按长度排序):');
candidates.sort((a, b) => b.name.length - a.name.length);
candidates.slice(0, 3).forEach(c => {
  const title = c.name.split('•')[0].trim();
  console.log(`  ${c.ref}: ${title}`);
});

await browser.close();
