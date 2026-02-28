// ============================================
// Form Filler — execCommand('insertText') approach
// Inspired by Playwright's element.type() / element.fill()
//
// Core idea: focus → select all → execCommand('insertText')
// This triggers REAL browser-level input events that ALL
// frameworks (React, Vue, Angular, etc.) respond to correctly,
// because the browser itself generates the events — not JS.
//
// No main world injection needed. No _valueTracker hacks.
// No framework detection. Just works™.
// ============================================

// 全局元素映射表：Accessibility Tree 提取时建立 id → DOM Element 映射
// 填充时通过 id 直接获取元素，不再依赖 CSS selector
let _elementMap = new Map();

/**
 * 设置元素映射表（由 form-extractor 提取 Accessibility Tree 时调用）
 * @param {Map<number, HTMLElement>} map
 */
export function setElementMap(map) {
  _elementMap = map;
}

/**
 * 获取元素映射表（供高亮定位等功能使用）
 * @returns {Map<number, HTMLElement>}
 */
export function getElementMap() {
  return _elementMap;
}

/**
 * 清除元素映射表
 */
export function clearElementMap() {
  _elementMap = new Map();
}

/**
 * Auto-fill form fields
 * @param {Array} fields - AI fill instructions [{ id, selector, label, value, type, options }]
 * @returns {Promise<number>} Number of successfully filled fields
 */
export async function fillForm(fields) {
  if (!fields || !Array.isArray(fields)) return 0;

  let filledCount = 0;
  // 记录已经填充过的真实 input 元素，防止多个 data-fh-id 映射到同一个 input 导致重复覆盖
  const filledInputs = new Set();

  for (const field of fields) {
    if (field.value === null || field.value === undefined || field.value === '') continue;
    // 支持两种模式：id（Accessibility Tree）或 selector（旧模式兜底）
    if (field.id == null && !field.selector) continue;

    try {
      // 优先通过 id 从元素映射表获取 DOM 元素
      let el = null;
      if (field.id != null && _elementMap.has(Number(field.id))) {
        el = _elementMap.get(Number(field.id));
      }

      // 检查真实 input 是否已被填充过，避免重复填写到同一个 input
      if (el) {
        const realInput = findRealInput(el);
        if (realInput && filledInputs.has(realInput)) {
          console.warn(`[FormHelper] ⚠️ 跳过重复填充: ${field.label} (id: ${field.id}) -> 真实 input 已被其他字段填充过`, realInput);
          continue;
        }
      }

      console.log(`[FormHelper] 🔍 ${field.label}`, el || field.selector, field.value);

      const success = el
        ? await fillFieldByElement(el, String(field.value), field.type, field.label)
        : (field.selector ? await fillField(field.selector, String(field.value), field.type, field.label) : false);

      if (success) {
        filledCount++;
        console.log(`[FormHelper] ✅ ${field.label}: ${field.value}`);
        // 记录已填充的真实 input 元素
        if (el) {
          const realInput = findRealInput(el);
          if (realInput) filledInputs.add(realInput);
        }
      } else {
        console.warn(`[FormHelper] ❌ Failed: ${field.label} (id: ${field.id}, selector: ${field.selector})`);
      }
      // 字段间等待，让框架完成状态更新
      await sleep(60);
    } catch (e) {
      console.error(`[FormHelper] Fill error ${field.label}:`, e);
    }
  }

  console.log(`[FormHelper] Filled ${filledCount}/${fields.length} fields`);
  return filledCount;
}

// ============================================
// 单字段填充入口（通过 DOM 元素直接填充）
// ============================================

async function fillFieldByElement(el, value, fieldType, label) {
  const input = findRealInput(el);
  if (!input) {
    console.warn(`[FormHelper] Cannot find real input in element:`, el, `(${label})`);
    return false;
  }
  return _doFill(el, input, value, fieldType, label);
}

// ============================================
// 单字段填充入口（通过 CSS selector 查找后填充）
// ============================================

async function fillField(selector, value, fieldType, label) {
  const el = findElement(selector);
  if (!el) {
    console.warn(`[FormHelper] Element not found: ${selector} (${label})`);
    return false;
  }

  const input = findRealInput(el);
  if (!input) return false;

  return _doFill(el, input, value, fieldType, label);
}

// ============================================
// 实际填充逻辑
// ============================================

async function _doFill(el, input, value, fieldType, label) {
  const tagName = input.tagName;
  const type = input.type?.toLowerCase() || fieldType || 'text';

  if (tagName === 'SELECT') return fillSelect(input, value);
  if (type === 'radio') return fillRadio(input, value);
  if (type === 'checkbox') return fillCheckbox(input, value);
  if (input.getAttribute('contenteditable') === 'true') return fillContentEditable(input, value);

  // 自定义 select 组件（div-based）
  if (tagName !== 'INPUT' && tagName !== 'TEXTAREA' && (
    fieldType === 'select' ||
    input.getAttribute('role') === 'combobox' ||
    input.getAttribute('role') === 'listbox'
  )) {
    return await fillCustomSelect(el, value);
  }

  // 标准 input / textarea — 核心路径
  return await fillTextInput(input, value);
}

// ============================================
// 核心：文本输入填充 (execCommand approach)
// ============================================

async function fillTextInput(input, value) {
  // 如果拿到的是非 input/textarea 元素（如 div[role="textbox"]），走 contenteditable 路径
  const tag = input.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
    if (input.getAttribute('contenteditable') === 'true' || input.getAttribute('role') === 'textbox') {
      return fillContentEditable(input, value);
    }
    // 尝试在内部找真正的 input
    const realInput = input.querySelector('input, textarea');
    if (realInput) {
      input = realInput;
    } else {
      // 最终兜底：当做 contenteditable 处理
      return fillContentEditable(input, value);
    }
  }

  // Step 1: 点击 + 聚焦（模拟用户点击输入框）
  simulateClick(input);
  input.focus();
  await sleep(10);

  // Step 2: 全选已有内容
  selectAllContent(input);
  await sleep(5);

  // Step 3: 用 execCommand 插入文本
  // 这是浏览器原生命令，会自动触发 beforeinput / input 事件
  // React、Vue、Angular 都能正确响应
  const success = document.execCommand('insertText', false, value);

  if (success && input.value === value) {
    // 触发 change + blur 完成填充
    await finishInput(input);
    return true;
  }

  console.log(`[FormHelper] execCommand failed or value mismatch (got "${input.value}", expected "${value}"), trying keyboard simulation...`);

  // Step 4: Fallback — 逐字符键盘模拟
  return await fillByTyping(input, value);
}

// ============================================
// Fallback：逐字符键盘模拟
// ============================================

async function fillByTyping(input, value) {
  // 重新聚焦并清空
  input.focus();
  await sleep(5);
  selectAllContent(input);

  // 尝试用 execCommand 删除选中内容
  document.execCommand('delete', false, null);
  // 如果 execCommand('delete') 不生效，手动清空
  if (input.value !== '') {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await sleep(5);

  // 逐字符输入
  for (let i = 0; i < value.length; i++) {
    const char = value[i];

    // keydown
    input.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true,
      key: char, code: getKeyCode(char),
      charCode: char.charCodeAt(0), keyCode: char.charCodeAt(0),
    }));

    // keypress（虽然已废弃，但部分框架/组件仍监听它）
    input.dispatchEvent(new KeyboardEvent('keypress', {
      bubbles: true, cancelable: true,
      key: char, code: getKeyCode(char),
      charCode: char.charCodeAt(0), keyCode: char.charCodeAt(0),
    }));

    // 尝试 execCommand 插入单个字符
    const inserted = document.execCommand('insertText', false, char);
    if (!inserted) {
      // execCommand 失败，手动设置值
      input.value = value.substring(0, i + 1);
      // 触发 input 事件
      try {
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: false,
          inputType: 'insertText', data: char,
        }));
      } catch (e) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // keyup
    input.dispatchEvent(new KeyboardEvent('keyup', {
      bubbles: true, cancelable: true,
      key: char, code: getKeyCode(char),
    }));

    // 每 5 个字符暂停一下，避免过快
    if (i % 5 === 4) await sleep(3);
  }

  await finishInput(input);

  // 验证
  await sleep(10);
  if (input.value === value) return true;

  // 最后兜底：直接设值 + 事件
  console.log(`[FormHelper] Typing fallback also failed (got "${input.value}"), trying direct set...`);
  return fillByDirectSet(input, value);
}

// ============================================
// 最终兜底：直接设值
// ============================================

function fillByDirectSet(input, value) {
  input.focus();
  input.value = value;

  // 触发完整事件链
  try {
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertText', data: value,
    }));
  } catch (e) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();

  return input.value === value;
}

// ============================================
// 完成输入（change + blur）
// ============================================

async function finishInput(input) {
  await sleep(10);
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(5);
  input.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

// ============================================
// Select 填充
// ============================================

function fillSelect(select, value) {
  const lowerValue = value.toLowerCase().trim();
  let targetValue = null;

  // 精确匹配 → 大小写不敏感 → 模糊包含
  for (const opt of select.options) {
    if (opt.value === value || opt.textContent.trim() === value) {
      targetValue = opt.value; break;
    }
  }
  if (!targetValue) {
    for (const opt of select.options) {
      if (opt.value.toLowerCase() === lowerValue || opt.textContent.trim().toLowerCase() === lowerValue) {
        targetValue = opt.value; break;
      }
    }
  }
  if (!targetValue) {
    for (const opt of select.options) {
      const text = opt.textContent.trim().toLowerCase();
      if (text.includes(lowerValue) || lowerValue.includes(text)) {
        targetValue = opt.value; break;
      }
    }
  }

  if (!targetValue) return false;

  select.focus();
  select.value = targetValue;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  select.blur();
  return true;
}

// ============================================
// Radio 填充
// ============================================

function fillRadio(input, value) {
  const name = input.name;
  if (!name) {
    simulateClick(input);
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
  const lowerValue = value.toLowerCase().trim();

  for (const radio of radios) {
    const label = radio.parentElement?.textContent?.trim()?.toLowerCase() || '';
    const radioValue = radio.value.toLowerCase();
    if (radioValue === lowerValue || label.includes(lowerValue) || lowerValue.includes(label)) {
      simulateClick(radio);
      radio.checked = true;
      radio.dispatchEvent(new Event('input', { bubbles: true }));
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  return false;
}

// ============================================
// Checkbox 填充
// ============================================

function fillCheckbox(input, value) {
  const name = input.name;
  const allCheckboxes = name
    ? document.querySelectorAll(`input[type="checkbox"][name="${name}"]`)
    : [];

  if (allCheckboxes.length > 1) {
    const selectedValues = value.split(',').map(v => v.trim().toLowerCase());
    allCheckboxes.forEach(cb => {
      const cbLabel = cb.parentElement?.textContent?.trim()?.toLowerCase() || '';
      const cbValue = cb.value.toLowerCase();
      const shouldCheck = selectedValues.includes(cbValue) || selectedValues.some(sv => cbLabel.includes(sv));
      if (cb.checked !== shouldCheck) {
        simulateClick(cb);
        cb.checked = shouldCheck;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    return true;
  }

  const shouldCheck = ['true', '1', 'yes', 'on', 'checked'].includes(value.toLowerCase());
  if (input.checked !== shouldCheck) {
    simulateClick(input);
    input.checked = shouldCheck;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

// ============================================
// ContentEditable 填充
// ============================================

function fillContentEditable(el, value) {
  el.focus();

  // 全选
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  // 用 execCommand 插入文本（和标准 input 一样的原理）
  const inserted = document.execCommand('insertText', false, value);
  if (!inserted) {
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
  return true;
}

// ============================================
// 自定义 Select（div-based dropdown）
// ============================================

async function fillCustomSelect(container, value) {
  const lowerValue = value.toLowerCase().trim();

  const optionSelectors = [
    '[role="option"]',
    '[class*="option" i]',
    '[class*="list-item" i]',
    '[class*="select-item" i]',
    '[class*="dropdown-item" i]',
    '[class*="menu-item" i]',
    'li',
  ];

  // 点击触发下拉
  const trigger = container.querySelector(
    '[class*="selection" i], [class*="trigger" i], [class*="chosen" i], ' +
    '[class*="selector" i], [class*="input" i], [class*="value" i]'
  ) || container;

  simulateClick(trigger);

  return new Promise(resolve => {
    setTimeout(async () => {
      let matched = false;

      const tryMatch = (options) => {
        for (const opt of options) {
          const text = opt.textContent.trim().toLowerCase();
          if (text === lowerValue || text.includes(lowerValue) || lowerValue.includes(text)) {
            simulateClick(opt);
            matched = true;
            return true;
          }
        }
        return false;
      };

      // 在容器内搜索选项
      for (const sel of optionSelectors) {
        const options = container.querySelectorAll(sel);
        if (options.length > 0 && tryMatch(options)) break;
      }

      // 搜索全局弹出层
      if (!matched) {
        const popups = document.querySelectorAll(
          '[class*="popup" i], [class*="dropdown" i], [class*="popper" i], ' +
          '[class*="overlay" i], [class*="portal" i], [class*="menu" i]:not(nav), ' +
          '[role="listbox"], [role="menu"]'
        );

        for (const popup of popups) {
          try {
            const style = getComputedStyle(popup);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
          } catch { continue; }

          for (const sel of optionSelectors) {
            const options = popup.querySelectorAll(sel);
            if (options.length > 0 && tryMatch(options)) break;
          }
          if (matched) break;
        }
      }

      // Fallback: 在下拉搜索框中输入
      if (!matched) {
        const searchInput = container.querySelector('input') ||
          document.querySelector('[class*="dropdown" i] input, [class*="popper" i] input, [role="listbox"] input');
        if (searchInput) {
          await fillTextInput(searchInput, value);
          await sleep(300);
          // 搜索后重新查找选项
          const popups = document.querySelectorAll(
            '[class*="dropdown" i], [class*="popper" i], [role="listbox"]'
          );
          for (const popup of popups) {
            for (const sel of optionSelectors) {
              const options = popup.querySelectorAll(sel);
              if (options.length > 0 && tryMatch(options)) break;
            }
            if (matched) break;
          }
        }
      }

      resolve(matched);
    }, 200);
  });
}

// ============================================
// 元素查找
// ============================================

function findElement(selector) {
  // 策略1：直接 querySelector
  try {
    const el = document.querySelector(selector);
    if (el) return el;
  } catch (e) { /* invalid selector */ }

  // 策略2：提取 [name="xxx"]
  const nameMatch = selector.match(/\[name=["']([^"']+)["']\]/);
  if (nameMatch) {
    try {
      const el = document.querySelector(`[name="${nameMatch[1]}"]`);
      if (el) return el;
    } catch (e) {}
  }

  // 策略3：提取 #id
  const idMatch = selector.match(/#([\w-]+)/);
  if (idMatch) {
    const el = document.getElementById(idMatch[1]);
    if (el) return el;
  }

  // 策略4：提取 [data-id="xxx"]
  const dataIdMatch = selector.match(/\[data-id=["']([^"']+)["']\]/);
  if (dataIdMatch) {
    try {
      const container = document.querySelector(`[data-id="${dataIdMatch[1]}"]`);
      if (container) {
        const input = container.querySelector('input:not([type="hidden"]), select, textarea');
        return input || container;
      }
    } catch (e) {}
  }

  // 策略5：selector 包含空格时，尝试只用最后一部分
  const parts = selector.split(/\s+/);
  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1];
    try {
      const el = document.querySelector(lastPart);
      if (el) return el;
    } catch (e) {}
  }

  // 策略6：提取 placeholder 进行模糊匹配
  const placeholderMatch = selector.match(/\[placeholder[*~^$]?=["']([^"']+)["']\]/i);
  if (placeholderMatch) {
    const el = document.querySelector(`[placeholder*="${placeholderMatch[1]}"]`);
    if (el) return el;
  }

  return null;
}

// ============================================
// 在容器中查找真实的 input 元素
// ============================================

function findRealInput(el) {
  if (!el) return null;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return el;
  // 先在 light DOM 中查找
  const inner = el.querySelector('input:not([type="hidden"]), textarea, select');
  if (inner) return inner;
  // 穿透 Shadow DOM 查找
  if (el.shadowRoot) {
    const shadowInner = el.shadowRoot.querySelector('input:not([type="hidden"]), textarea, select');
    if (shadowInner) return shadowInner;
  }
  // 递归检查子元素的 Shadow DOM
  const children = el.querySelectorAll('*');
  for (const child of children) {
    if (child.shadowRoot) {
      const shadowInner = child.shadowRoot.querySelector('input:not([type="hidden"]), textarea, select');
      if (shadowInner) return shadowInner;
    }
  }
  return el;
}

// ============================================
// 模拟鼠标点击
// ============================================

function simulateClick(el) {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };

  try { el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' })); } catch (e) {}
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  try { el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' })); } catch (e) {}
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

// ============================================
// 工具函数
// ============================================

/**
 * 安全地全选输入框内容
 * 兼容 input/textarea 以及不支持 select()/setSelectionRange() 的特殊 type
 */
function selectAllContent(input) {
  // 方法1：input.select()（标准 input/textarea 方法）
  if (typeof input.select === 'function') {
    try { input.select(); } catch (e) {}
  }
  // 方法2：setSelectionRange 兜底
  try {
    input.setSelectionRange(0, (input.value || '').length);
  } catch (e) { /* 某些 type（如 date/color）不支持 */ }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getKeyCode(char) {
  const code = char.charCodeAt(0);
  if (code >= 65 && code <= 90) return `Key${char}`;
  if (code >= 97 && code <= 122) return `Key${char.toUpperCase()}`;
  if (code >= 48 && code <= 57) return `Digit${char}`;
  return `Key${char}`;
}
