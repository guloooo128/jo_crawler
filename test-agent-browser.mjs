import { BrowserManager } from 'agent-browser/dist/browser.js';

const browser = new BrowserManager();

console.log('✅ BrowserManager 导入成功！');
console.log('可用方法:', Object.getOwnPropertyNames(Object.getPrototypeOf(browser)).slice(0, 10));
