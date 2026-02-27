// ============================================
// 表单监听器（增强版）
// 多策略监听表单提交事件
// ============================================

import { extractFormFields, detectFormRegions } from './form-extractor.js';

/** 提交按钮关键词 */
const SUBMIT_KEYWORDS = [
  '提交', '注册', '登录', '确认', '保存', '发送', '申请', '下一步', '完成', '预约', '购买', '支付', '订购', '预订',
  'submit', 'register', 'login', 'sign', 'confirm', 'save', 'send', 'apply', 'next',
  'complete', 'book', 'buy', 'pay', 'order', 'reserve', 'checkout', 'continue',
];

/**
 * 初始化表单监听
 * @param {Function} onFormSubmit - 表单提交时的回调 (rawFields, formElement)
 */
export function initFormObserver(onFormSubmit) {
  // 策略1：监听原生 submit 事件
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const fields = extractFormFields(form);
    if (fields.length > 0) {
      onFormSubmit(fields, form);
    }
  }, true); // 捕获阶段

  // 策略2：监听可能的提交按钮点击
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button, [role="button"], input[type="submit"], a.btn, a.button, [class*="submit" i], [class*="btn" i]');
    if (!btn) return;

    if (isSubmitButton(btn)) {
      // 延迟一点确保表单值已更新
      setTimeout(() => {
        const forms = detectFormRegions();
        for (const form of forms) {
          // 按钮在表单内或距离很近
          if (form.contains(btn) || isNearby(form, btn)) {
            const fields = extractFormFields(form);
            if (fields.length > 0) {
              onFormSubmit(fields, form);
              break;
            }
          }
        }
      }, 200);
    }
  }, true);

  // 策略3：监听 Enter 键提交
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target;
    if (!['INPUT', 'SELECT'].includes(input.tagName) && !input.getAttribute('role')) return;

    const form = input.closest('form') || detectFormRegions().find(f => f.contains(input));
    if (form) {
      setTimeout(() => {
        const fields = extractFormFields(form);
        if (fields.length > 0) {
          onFormSubmit(fields, form);
        }
      }, 200);
    }
  }, true);

  // 策略4：监听 fetch/XHR 提交（SPA 常见模式）
  interceptAjaxSubmit(onFormSubmit);

  console.log('[FormHelper] 表单监听已启动（增强模式）');
}

/**
 * 拦截 Ajax 提交（fetch 和 XMLHttpRequest）
 * 当检测到 POST/PUT 请求时，检查页面中是否有已填写的表单
 */
function interceptAjaxSubmit(onFormSubmit) {
  // 拦截 fetch
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const [resource, options] = args;
    if (options && ['POST', 'PUT', 'PATCH'].includes(options.method?.toUpperCase())) {
      // 延迟检查，让表单数据有时间同步
      setTimeout(() => {
        checkFormsAfterAjax(onFormSubmit);
      }, 100);
    }
    return originalFetch.apply(this, args);
  };

  // 拦截 XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function (method, ...rest) {
    this._formHelperMethod = method;
    return originalXHROpen.call(this, method, ...rest);
  };
  
  XMLHttpRequest.prototype.send = function (...args) {
    if (['POST', 'PUT', 'PATCH'].includes(this._formHelperMethod?.toUpperCase())) {
      setTimeout(() => {
        checkFormsAfterAjax(onFormSubmit);
      }, 100);
    }
    return originalXHRSend.apply(this, args);
  };
}

/** Ajax 提交后检查表单 */
let lastAjaxCheckTime = 0;
function checkFormsAfterAjax(onFormSubmit) {
  const now = Date.now();
  if (now - lastAjaxCheckTime < 2000) return; // 2秒内不重复检查
  lastAjaxCheckTime = now;

  const forms = detectFormRegions();
  for (const form of forms) {
    const fields = extractFormFields(form);
    // 只有至少3个有值的字段才认为是有效表单提交
    if (fields.length >= 3) {
      onFormSubmit(fields, form);
      break;
    }
  }
}

/**
 * 判断元素是否是提交按钮
 */
function isSubmitButton(el) {
  // type="submit"
  if (el.type === 'submit') return true;

  // 文本匹配
  const text = (el.textContent || '').trim().toLowerCase();
  if (text.length < 20 && SUBMIT_KEYWORDS.some(kw => text.includes(kw))) return true;

  // class/id 匹配
  const classAndId = `${el.className} ${el.id}`.toLowerCase();
  if (/submit|confirm|register|login|sign|checkout|book|pay/.test(classAndId)) return true;

  // aria-label 匹配
  const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
  if (SUBMIT_KEYWORDS.some(kw => ariaLabel.includes(kw))) return true;

  return false;
}

/**
 * 判断两个元素是否距离较近（DOM 层级）
 */
function isNearby(el1, el2) {
  // 共享5层以内的祖先
  let parent = el2.parentElement;
  let depth = 0;
  while (parent && depth < 5) {
    if (parent.contains(el1)) return true;
    parent = parent.parentElement;
    depth++;
  }
  return false;
}
