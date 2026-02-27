
/**
 * 简易构建脚本
 * 将 ES Module 代码打包为可在 Chrome Extension 中运行的单文件
 * 
 * Chrome Extension Manifest V3 的 Content Script 不支持 ES Module，
 * 因此需要将所有模块合并为一个 IIFE。
 * Background Service Worker 支持 module 模式。
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// 确保 dist 目录存在
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
if (!fs.existsSync(path.join(DIST, 'icons'))) fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });

// ========== 1. 复制 manifest.json ==========
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
// 修改路径指向 dist 的结构
manifest.background.service_worker = 'background.js';
manifest.content_scripts[0].js = ['content.js'];
manifest.content_scripts[0].css = ['content.css'];
manifest.action.default_popup = 'popup.html';
fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));

// ========== 2. 构建 Background Service Worker ==========
// Background 支持 module，但为简化，我们也合并为单文件
const bgCode = buildBackground();
fs.writeFileSync(path.join(DIST, 'background.js'), bgCode);

// ========== 3. 构建 Content Script（IIFE）==========
const contentCode = buildContentScript();
fs.writeFileSync(path.join(DIST, 'content.js'), contentCode);

// ========== 4. 复制 Content CSS ==========
fs.copyFileSync(
  path.join(ROOT, 'src/content/ui/styles.css'),
  path.join(DIST, 'content.css')
);

// ========== 5. 构建 Popup ==========
fs.copyFileSync(path.join(ROOT, 'src/popup/index.html'), path.join(DIST, 'popup.html'));
// 修正 popup.html 中的脚本引用
let popupHtml = fs.readFileSync(path.join(DIST, 'popup.html'), 'utf-8');
popupHtml = popupHtml.replace('src="popup.js"', 'src="popup.js"');
fs.writeFileSync(path.join(DIST, 'popup.html'), popupHtml);
fs.copyFileSync(path.join(ROOT, 'src/popup/popup.js'), path.join(DIST, 'popup.js'));

// ========== 6. 生成占位图标 ==========
generatePlaceholderIcons();

// ========== 7. 复制测试页面 ==========
if (fs.existsSync(path.join(ROOT, 'test.html'))) {
  fs.copyFileSync(path.join(ROOT, 'test.html'), path.join(DIST, 'test.html'));
}

console.log('✅ 构建完成！输出目录: dist/');
console.log('   - dist/manifest.json');
console.log('   - dist/background.js');
console.log('   - dist/content.js');
console.log('   - dist/content.css');
console.log('   - dist/popup.html');
console.log('   - dist/popup.js');
console.log('   - dist/icons/');

// ============================================
// 构建函数
// ============================================

function readSrc(relativePath) {
  return fs.readFileSync(path.join(ROOT, 'src', relativePath), 'utf-8');
}

/**
 * 移除 import/export 语句，提取纯逻辑代码
 */
function stripModuleSyntax(code) {
  // 移除多行 import 语句（如 import {\n  ...\n} from '...'）
  code = code.replace(/^import\s+\{[^}]*\}\s*from\s*['"].*?['"];?\s*$/gm, '');
  // 移除单行 import 语句
  code = code.replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '');
  code = code.replace(/^import\s+['"].*?['"];?\s*$/gm, '');
  // 将 export function 改为 function
  code = code.replace(/^export\s+function\s/gm, 'function ');
  // 将 export async function 改为 async function
  code = code.replace(/^export\s+async\s+function\s/gm, 'async function ');
  // 将 export const 改为 const
  code = code.replace(/^export\s+const\s/gm, 'const ');
  // 将 export let 改为 let
  code = code.replace(/^export\s+let\s/gm, 'let ');
  // 移除 export { ... }
  code = code.replace(/^export\s+\{[^}]*\};?\s*$/gm, '');
  // 移除 export default
  code = code.replace(/^export\s+default\s+/gm, '');
  return code;
}

function buildBackground() {
  const files = [
    'shared/constants.js',
    'shared/utils.js',
    'background/prompt-templates.js',
    'background/ai-service.js',
    'background/storage-manager.js',
    'background/message-router.js',
    'background/index.js',
  ];

  let code = '// AI 表单助手 - Background Service Worker (自动构建)\n';
  code += '// 构建时间: ' + new Date().toISOString() + '\n\n';

  for (const file of files) {
    code += `// ========== ${file} ==========\n`;
    code += stripModuleSyntax(readSrc(file));
    code += '\n\n';
  }

  return code;
}

function buildContentScript() {
  const files = [
    'shared/constants.js',
    'shared/utils.js',
    'content/component-adapters.js',
    'content/form-extractor.js',
    'content/form-observer.js',
    'content/form-filler.js',
    'content/ui/confirm-dialog.js',
    'content/ui/autofill-button.js',
    'content/index.js',
  ];

  let code = '// AI 表单助手 - Content Script (自动构建)\n';
  code += '// 构建时间: ' + new Date().toISOString() + '\n\n';
  code += '(function() {\n"use strict";\n\n';

  for (const file of files) {
    code += `// ========== ${file} ==========\n`;
    code += stripModuleSyntax(readSrc(file));
    code += '\n\n';
  }

  code += '})();\n';
  return code;
}

function generatePlaceholderIcons() {
  // 生成简单的 SVG 图标并转为 data URI（实际项目应该用真正的 PNG 图标）
  // 这里创建简单的文字占位图标
  const sizes = [16, 48, 128];
  
  for (const size of sizes) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="url(#g)"/>
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#667eea"/><stop offset="100%" stop-color="#764ba2"/></linearGradient></defs>
      <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="${size * 0.5}px" font-family="Arial">F</text>
    </svg>`;

    // 由于 Chrome Extension 需要 PNG，我们这里先放 SVG，提示用户替换
    // 实际上创建一个最简 PNG (1x1 透明像素扩展)
    // 为了 demo 能跑，我们用一个 base64 编码的最小 PNG
    const minPng = createMinimalPng(size);
    fs.writeFileSync(path.join(DIST, 'icons', `icon${size}.png`), minPng);
  }
}

/**
 * 创建最小可用的 PNG 图标
 */
function createMinimalPng(size) {
  // 最简PNG：一个紫色方块
  // PNG header
  const { createCanvas } = (() => {
    try { return require('canvas'); } catch { return {}; }
  })();

  // 如果没有 canvas 库，用预置的最小 PNG
  // 这是一个 1x1 紫色像素的 PNG，base64 编码
  const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  return Buffer.from(base64Png, 'base64');
}
