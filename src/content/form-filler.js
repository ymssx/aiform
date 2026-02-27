// ============================================
// 表单填充器（AI DOM 分析版）
// 根据 AI 返回的填充指令（含 CSS 选择器）自动填充表单
// ============================================

/**
 * 自动填充表单
 * @param {Array} fields - AI 返回的填充指令数组 [{ selector, label, value, type, options }]
 * @returns {number} 成功填充的字段数
 */
export function fillForm(fields) {
  if (!fields || !Array.isArray(fields)) return 0;

  let filledCount = 0;

  for (const field of fields) {
    if (!field.value || field.value === null || field.value === undefined) continue;
    if (!field.selector) continue;

    try {
      const input = findElement(field.selector);
      if (!input) {
        console.warn(`[FormHelper] 未找到元素: ${field.selector} (${field.label})`);
        continue;
      }

      const success = setFieldValue(input, String(field.value), field.type);
      if (success) {
        filledCount++;
        console.log(`[FormHelper] ✅ ${field.label}: ${field.value}`);
      }
    } catch (e) {
      console.error(`[FormHelper] 填充失败 ${field.label}:`, e);
    }
  }

  console.log(`[FormHelper] 已填充 ${filledCount}/${fields.length} 个字段`);
  return filledCount;
}

/**
 * 通过 CSS 选择器查找元素（增强版，支持多种定位策略）
 * @param {string} selector - CSS 选择器
 * @returns {HTMLElement|null}
 */
function findElement(selector) {
  // 直接尝试选择器
  try {
    const el = document.querySelector(selector);
    if (el) return el;
  } catch (e) { /* 选择器可能无效 */ }

  // 如果是复合选择器（AI 可能返回类似 "form > div > input[name='xxx']"），尝试简化
  // 提取其中的 [name="xxx"] 或 #id 部分单独匹配
  const nameMatch = selector.match(/\[name=["']([^"']+)["']\]/);
  if (nameMatch) {
    const el = document.querySelector(`[name="${CSS.escape(nameMatch[1])}"]`);
    if (el) return el;
  }

  const idMatch = selector.match(/#([\w-]+)/);
  if (idMatch) {
    const el = document.getElementById(idMatch[1]);
    if (el) return el;
  }

  const dataIdMatch = selector.match(/\[data-id=["']([^"']+)["']\]/);
  if (dataIdMatch) {
    const container = document.querySelector(`[data-id="${CSS.escape(dataIdMatch[1])}"]`);
    if (container) {
      // 在容器内找实际的输入元素
      const input = container.querySelector('input:not([type="hidden"]), select, textarea');
      if (input) return input;
      return container; // 可能是自定义组件 div
    }
  }

  return null;
}

/**
 * 设置字段值并触发相关事件
 * @param {HTMLElement} input - 目标元素
 * @param {string} value - 要设置的值
 * @param {string} fieldType - AI 识别的字段类型
 * @returns {boolean}
 */
function setFieldValue(input, value, fieldType) {
  try {
    const tagName = input.tagName;
    const type = input.type?.toLowerCase() || fieldType || 'text';

    // 原生 <select>
    if (tagName === 'SELECT') {
      return setSelectValue(input, value);
    }

    // radio
    if (type === 'radio') {
      return setRadioValue(input, value);
    }

    // checkbox
    if (type === 'checkbox') {
      return setCheckboxValue(input, value);
    }

    // contenteditable
    if (input.getAttribute('contenteditable') === 'true') {
      input.textContent = value;
      triggerEvents(input);
      return true;
    }

    // 自定义下拉组件（非原生 select 的 div）
    if (tagName !== 'INPUT' && tagName !== 'TEXTAREA' && (fieldType === 'select' || input.getAttribute('role') === 'combobox' || input.getAttribute('role') === 'listbox')) {
      return setCustomSelectValue(input, value);
    }

    // 通用 input / textarea
    let nativeSetter;
    if (tagName === 'TEXTAREA') {
      nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
    } else if (tagName === 'INPUT') {
      nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
    }

    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      // 非原生元素，但 AI 认为是 text 类型
      // 尝试找内部的原生 input
      const innerInput = input.querySelector('input:not([type="hidden"]), textarea');
      if (innerInput) {
        return setFieldValue(innerInput, value, fieldType);
      }
      input.value = value;
    }

    triggerEvents(input);
    return true;
  } catch (e) {
    console.error(`[FormHelper] 填充字段失败:`, e);
    return false;
  }
}

/**
 * 设置 select 的值
 */
function setSelectValue(select, value) {
  // 精确匹配 value 或 text
  for (const option of select.options) {
    if (option.value === value || option.textContent.trim() === value) {
      select.value = option.value;
      triggerEvents(select);
      return true;
    }
  }
  // 模糊匹配
  for (const option of select.options) {
    if (option.textContent.trim().includes(value) || value.includes(option.textContent.trim())) {
      select.value = option.value;
      triggerEvents(select);
      return true;
    }
  }
  return false;
}

/**
 * 设置 radio 的值
 */
function setRadioValue(input, value) {
  const name = input.name;
  if (!name) {
    input.checked = true;
    triggerEvents(input);
    return true;
  }
  const radios = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`);
  for (const radio of radios) {
    const label = radio.parentElement?.textContent?.trim() || radio.value;
    if (radio.value === value || label.includes(value) || value.includes(label)) {
      radio.checked = true;
      triggerEvents(radio);
      return true;
    }
  }
  return false;
}

/**
 * 设置 checkbox 的值
 */
function setCheckboxValue(input, value) {
  const name = input.name;
  const allCheckboxes = name ? document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(name)}"]`) : [];

  if (allCheckboxes.length > 1) {
    // checkbox 组：value 为逗号分隔
    const selectedValues = value.split(',').map(v => v.trim().toLowerCase());
    allCheckboxes.forEach(cb => {
      const cbLabel = cb.parentElement?.textContent?.trim() || cb.value;
      const shouldCheck = selectedValues.includes(cb.value.toLowerCase()) || selectedValues.includes(cbLabel.toLowerCase());
      if (cb.checked !== shouldCheck) {
        cb.checked = shouldCheck;
        triggerEvents(cb);
      }
    });
    return true;
  }

  // 单个 checkbox
  const shouldCheck = ['true', '1', 'yes', '是', 'on', 'checked'].includes(value.toLowerCase());
  if (input.checked !== shouldCheck) {
    input.checked = shouldCheck;
    triggerEvents(input);
  }
  return true;
}

/**
 * 设置自定义下拉组件的值（通过模拟点击）
 */
function setCustomSelectValue(container, value) {
  // 尝试找到选项列表（可能在容器内部或全局弹出层中）
  const optionSelectors = [
    '[role="option"]',
    '[class*="option" i]',
    '[class*="list_item" i]',
    '[class*="select-item" i]',
    '[class*="dropdown-item" i]',
    'li',
  ];

  // 先尝试点击触发器展开下拉
  const trigger = container.querySelector('[class*="chosen" i], [class*="trigger" i], [class*="selection" i], [class*="input" i]') || container;
  trigger.click();

  // 等一小段时间让下拉展开
  return new Promise(resolve => {
    setTimeout(() => {
      let matched = false;

      // 在容器内部查找选项
      for (const sel of optionSelectors) {
        const options = container.querySelectorAll(sel);
        for (const opt of options) {
          const text = opt.textContent.trim();
          if (text === value || text.includes(value) || value.includes(text)) {
            opt.click();
            matched = true;
            break;
          }
        }
        if (matched) break;
      }

      // 如果容器内没找到，搜索全局的弹出层
      if (!matched) {
        const popups = document.querySelectorAll('[class*="popup" i], [class*="dropdown" i], [class*="popper" i], [class*="overlay" i]');
        for (const popup of popups) {
          try {
            if (getComputedStyle(popup).display === 'none') continue;
          } catch { continue; }

          for (const sel of optionSelectors) {
            const options = popup.querySelectorAll(sel);
            for (const opt of options) {
              const text = opt.textContent.trim();
              if (text === value || text.includes(value) || value.includes(text)) {
                opt.click();
                matched = true;
                break;
              }
            }
            if (matched) break;
          }
          if (matched) break;
        }
      }

      resolve(matched);
    }, 200);
  });
}

/**
 * 触发 input / change / blur 事件确保框架检测到变化
 */
function triggerEvents(element) {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}
