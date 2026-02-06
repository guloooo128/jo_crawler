import { BrowserManager } from 'agent-browser/dist/browser.js';

const browser = new BrowserManager();
await browser.launch({ headless: true });

const page = browser.getPage();
await page.goto('https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs/preview/210690325/?keyword=intern', { waitUntil: 'networkidle' });

await page.waitForTimeout(3000);

const snapshot = await browser.getSnapshot({ interactive: true, maxDepth: 3 });
console.log('=== TREE ===');
console.log(snapshot.tree.substring(0, 2000));
console.log('\n=== REFS ===');
console.log(JSON.stringify(snapshot.refs, null, 2).substring(0, 1000));

await browser.close();
