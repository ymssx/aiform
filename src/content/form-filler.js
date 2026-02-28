// ============================================
// Form Filler (AI DOM Analysis Version)
// Fills forms based on AI instructions (with CSS selectors)
// Supports React, Vue, Angular, and other modern frameworks
// ============================================

/**
 * Auto-fill form fields
 * @param {Array} fields - AI fill instructions [{ selector, label, value, type, options }]
 * @returns {Promise<number>} Number of successfully filled fields
 */
export async function fillForm(fields) {
  if (!fields || !Array.isArray(fields)) return 0;

  let filledCount = 0;

  for (const field of fields) {
    if (!field.value || field.value === null || field.value === undefined) continue;
    if (!field.selector) continue;

    try {
      const input = findElement(field.selector);
      if (!input) {
        console.warn(`[FormHelper] Element not found: ${field.selector} (${field.label})`);
        continue;
      }

      const success = await setFieldValue(input, String(field.value), field.type);
      if (success) {
        filledCount++;
        console.log(`[FormHelper] ✅ ${field.label}: ${field.value}`);
      } else {
        console.warn(`[FormHelper] ❌ Failed: ${field.label}`);
      }

      // 关键：字段间等待一小段时间，让框架完成状态更新
      await sleep(50);
    } catch (e) {
      console.error(`[FormHelper] Fill failed ${field.label}:`, e);
    }
  }

  console.log(`[FormHelper] Filled ${filledCount}/${fields.length} fields`);
  return filledCount;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// Element Finder
// ============================================

function findElement(selector) {
  // Direct selector match
  try {
    const el = document.querySelector(selector);
    if (el) return el;
  } catch (e) { /* invalid selector */ }

  // Extract [name="xxx"] part
  const nameMatch = selector.match(/\[name=["']([^"']+)["']\]/);
  if (nameMatch) {
    const el = document.querySelector(`[name="${CSS.escape(nameMatch[1])}"]`);
    if (el) return el;
  }

  // Extract #id part
  const idMatch = selector.match(/#([\w-]+)/);
  if (idMatch) {
    const el = document.getElementById(idMatch[1]);
    if (el) return el;
  }

  // Extract [data-id="xxx"] and find inner input
  const dataIdMatch = selector.match(/\[data-id=["']([^"']+)["']\]/);
  if (dataIdMatch) {
    const container = document.querySelector(`[data-id="${CSS.escape(dataIdMatch[1])}"]`);
    if (container) {
      const input = container.querySelector('input:not([type="hidden"]), select, textarea');
      if (input) return input;
      return container;
    }
  }

  return null;
}

// ============================================
// Framework Detection
// ============================================

function detectFramework(el) {
  // 向上遍历最多 5 层来检测框架
  let current = el;
  let depth = 0;
  while (current && depth < 5) {
    const keys = Object.keys(current);

    // React
    if (keys.some(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$') || k.startsWith('__reactProps$'))) {
      return 'react';
    }

    // Vue
    if (current.__vue__ || current.__vueParentComponent || current.__vue_app__) {
      return 'vue';
    }
    if (keys.some(k => k.startsWith('__vnode'))) {
      return 'vue';
    }

    // Angular
    if (current.__ngContext__ || keys.some(k => k.startsWith('__ng'))) {
      return 'angular';
    }

    current = current.parentElement;
    depth++;
  }

  // 额外检测：全局标记
  if (document.querySelector('[data-reactroot]') || document.querySelector('#__next') || document.querySelector('#root[data-reactroot]')) {
    return 'react';
  }
  if (document.querySelector('[data-v-app]') || document.querySelector('#app[data-v-app]')) {
    return 'vue';
  }
  if (document.querySelector('[ng-version]')) {
    return 'angular';
  }

  return 'native';
}

// ============================================
// Core: Set Field Value
// ============================================

async function setFieldValue(input, value, fieldType) {
  try {
    const tagName = input.tagName;
    const type = input.type?.toLowerCase() || fieldType || 'text';

    // 1. Native <select>
    if (tagName === 'SELECT') {
      return setSelectValue(input, value);
    }

    // 3. Radio buttons
    if (type === 'radio') {
      return setRadioValue(input, value);
    }

    // 4. Checkboxes
    if (type === 'checkbox') {
      return setCheckboxValue(input, value);
    }

    // 5. contenteditable
    if (input.getAttribute('contenteditable') === 'true') {
      return setContentEditableValue(input, value);
    }

    // 6. Custom select components (div-based)
    if (tagName !== 'INPUT' && tagName !== 'TEXTAREA' && (
      fieldType === 'select' ||
      input.getAttribute('role') === 'combobox' ||
      input.getAttribute('role') === 'listbox'
    )) {
      return await setCustomSelectValue(input, value);
    }

    // 7. Standard input / textarea — simulate full user input
    return await simulateUserInput(input, value);
  } catch (e) {
    console.error(`[FormHelper] Fill field error:`, e);
    return false;
  }
}

// ============================================
// Simulate User Input (React/Vue/Angular compatible)
// ============================================

/**
 * 核心填充函数：模拟真实用户输入
 * 
 * 关键设计：
 * 1. 先 focus，再设值，再触发 input/change 事件
 * 2. blur 事件延后触发（不要和 input 事件同步）
 * 3. React: 必须清除 _valueTracker
 * 4. Vue: 需要 compositionend 事件
 * 5. 如果第一次尝试失败，用逐字符输入作为 fallback
 */
async function simulateUserInput(input, value) {
  const tagName = input.tagName;

  // 找到真实的 input 元素
  let targetInput = input;
  if (tagName !== 'INPUT' && tagName !== 'TEXTAREA') {
    const inner = input.querySelector('input:not([type="hidden"]), textarea');
    if (inner) {
      targetInput = inner;
    } else {
      // 最后手段：直接赋值
      input.value = value;
      dispatchInputEvents(input, value);
      return true;
    }
  }

  const framework = detectFramework(targetInput);
  console.log(`[FormHelper] Framework detected: ${framework} for`, targetInput);

  // 获取原生 setter
  const nativeSetter = getNativeSetter(targetInput);

  // ===== 第一次尝试：标准模拟 =====
  
  // Step 1: Focus
  targetInput.focus();
  targetInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

  // Step 2: 小延迟让 focus 事件处理完成
  await sleep(10);

  // Step 3: 清除旧值（某些框架需要先清空再设置，才能检测到变化）
  if (framework === 'react') {
    clearReactValueTracker(targetInput);
  }

  // Step 4: 用 native setter 设值（绕过框架的 property getter/setter）
  if (nativeSetter) {
    nativeSetter.call(targetInput, value);
  } else {
    targetInput.value = value;
  }

  // Step 5: 触发 input 和 change 事件（不触发 blur！）
  dispatchInputEvents(targetInput, value);

  // Step 6: Vue v-model 需要 compositionend
  if (framework === 'vue') {
    targetInput.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }));
  }

  // Step 7: 等一下让框架处理事件
  await sleep(20);

  // Step 8: 触发 change + blur（延迟触发）
  targetInput.dispatchEvent(new Event('change', { bubbles: true }));
  targetInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  targetInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

  // Step 9: 检查值是否真的设置成功
  await sleep(10);
  if (targetInput.value === value) {
    return true;
  }

  console.log(`[FormHelper] First attempt failed (got "${targetInput.value}", expected "${value}"), trying fallback...`);

  // ===== Fallback：逐字符模拟输入 =====
  return await simulateTyping(targetInput, value, framework);
}

/**
 * Fallback 方案：逐字符模拟键盘输入
 * 这种方式最接近真实用户行为，几乎所有框架都能响应
 */
async function simulateTyping(input, value, framework) {
  // 先 focus 并清空
  input.focus();
  input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await sleep(10);

  // 清空现有内容
  const nativeSetter = getNativeSetter(input);
  if (framework === 'react') {
    clearReactValueTracker(input);
  }
  if (nativeSetter) {
    nativeSetter.call(input, '');
  } else {
    input.value = '';
  }
  dispatchInputEvents(input, '');
  await sleep(10);

  // 逐字符输入
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const currentValue = value.substring(0, i + 1);

    // keydown
    input.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: char, code: `Key${char.toUpperCase()}`,
      charCode: char.charCodeAt(0), keyCode: char.charCodeAt(0),
    }));

    // keypress
    input.dispatchEvent(new KeyboardEvent('keypress', {
      bubbles: true, cancelable: true, key: char, code: `Key${char.toUpperCase()}`,
      charCode: char.charCodeAt(0), keyCode: char.charCodeAt(0),
    }));

    // 设值
    if (framework === 'react') {
      clearReactValueTracker(input);
    }
    if (nativeSetter) {
      nativeSetter.call(input, currentValue);
    } else {
      input.value = currentValue;
    }

    // input event
    try {
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: false, inputType: 'insertText', data: char,
      }));
    } catch (e) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // keyup
    input.dispatchEvent(new KeyboardEvent('keyup', {
      bubbles: true, cancelable: true, key: char, code: `Key${char.toUpperCase()}`,
    }));

    // 每 5 个字符暂停一下，模拟打字节奏（但不要太慢）
    if (i % 5 === 4) {
      await sleep(5);
    }
  }

  // 最终 change + blur
  await sleep(10);
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // Vue compositionend
  if (framework === 'vue') {
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }));
  }

  await sleep(10);
  input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

  return input.value === value;
}

/**
 * 获取元素的原生 value setter
 */
function getNativeSetter(el) {
  if (el.tagName === 'TEXTAREA') {
    return Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  }
  if (el.tagName === 'SELECT') {
    return Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  }
  return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
}

/**
 * 清除 React 的 _valueTracker
 * React 16+ 用 _valueTracker 追踪"上次已知值"
 * 如果不清除，React 对比发现值没变就会跳过 onChange 回调
 */
function clearReactValueTracker(el) {
  const tracker = el._valueTracker;
  if (tracker) {
    tracker.setValue('__form_helper_force_update__');
  }
}

/**
 * 触发 input 相关事件（不包含 blur）
 * 将 blur 和 input 分开，是修复的核心
 */
function dispatchInputEvents(el, value) {
  // beforeinput
  try {
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: value,
    }));
  } catch (e) { /* not supported */ }

  // input — 使用 InputEvent 而非 Event（React 17+, Vue 3 需要 InputEvent）
  try {
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: false, inputType: 'insertText', data: value,
    }));
  } catch (e) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ============================================
// contenteditable
// ============================================

function setContentEditableValue(el, value) {
  el.focus();

  // 选中全部内容
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  // 用 execCommand 插入文本（兼容 Draft.js / Slate / ProseMirror）
  const inserted = document.execCommand('insertText', false, value);
  if (!inserted) {
    // fallback
    el.textContent = value;
  }

  dispatchInputEvents(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  return true;
}

// ============================================
// Select / Radio / Checkbox handlers
// ============================================

function setSelectValue(select, value) {
  const lowerValue = value.toLowerCase().trim();

  // Exact match
  for (const option of select.options) {
    if (option.value === value || option.textContent.trim() === value) {
      return applySelectOption(select, option.value);
    }
  }

  // Case-insensitive
  for (const option of select.options) {
    const optText = option.textContent.trim().toLowerCase();
    if (option.value.toLowerCase() === lowerValue || optText === lowerValue) {
      return applySelectOption(select, option.value);
    }
  }

  // Fuzzy (contains)
  for (const option of select.options) {
    const optText = option.textContent.trim().toLowerCase();
    if (optText.includes(lowerValue) || lowerValue.includes(optText)) {
      return applySelectOption(select, option.value);
    }
  }

  return false;
}

function applySelectOption(select, optionValue) {
  const nativeSetter = getNativeSetter(select);

  if (nativeSetter) {
    nativeSetter.call(select, optionValue);
  } else {
    select.value = optionValue;
  }

  clearReactValueTracker(select);

  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function setRadioValue(input, value) {
  const name = input.name;
  if (!name) {
    simulateClick(input);
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  const radios = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`);
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

function setCheckboxValue(input, value) {
  const name = input.name;
  const allCheckboxes = name
    ? document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(name)}"]`)
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
        cb.dispatchEvent(new Event('input', { bubbles: true }));
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    return true;
  }

  // Single checkbox
  const shouldCheck = ['true', '1', 'yes', 'on', 'checked'].includes(value.toLowerCase());
  if (input.checked !== shouldCheck) {
    simulateClick(input);
    input.checked = shouldCheck;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

// ============================================
// Custom Select Components (div-based)
// ============================================

function setCustomSelectValue(container, value) {
  const lowerValue = value.toLowerCase().trim();

  const optionSelectors = [
    '[role="option"]',
    '[class*="option" i]',
    '[class*="list-item" i]',
    '[class*="list_item" i]',
    '[class*="select-item" i]',
    '[class*="dropdown-item" i]',
    '[class*="menu-item" i]',
    'li',
  ];

  // Click trigger to open dropdown
  const trigger = container.querySelector(
    '[class*="selection" i], [class*="trigger" i], [class*="chosen" i], ' +
    '[class*="selector" i], [class*="input" i], [class*="value" i]'
  ) || container;

  simulateClick(trigger);

  return new Promise(resolve => {
    setTimeout(() => {
      let matched = false;

      const tryMatch = (options) => {
        for (const opt of options) {
          const text = opt.textContent.trim();
          const lowerText = text.toLowerCase();
          if (lowerText === lowerValue || lowerText.includes(lowerValue) || lowerValue.includes(lowerText)) {
            simulateClick(opt);
            matched = true;
            return true;
          }
        }
        return false;
      };

      // Search in container
      for (const sel of optionSelectors) {
        const options = container.querySelectorAll(sel);
        if (options.length > 0 && tryMatch(options)) break;
      }

      // Search global popups/dropdowns
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

      // Fallback: type into search input
      if (!matched) {
        const searchInput = container.querySelector('input') ||
          document.querySelector('[class*="dropdown" i] input, [class*="popper" i] input, [role="listbox"] input');
        if (searchInput) {
          simulateUserInput(searchInput, value).then(() => {
            setTimeout(() => {
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
              resolve(matched);
            }, 300);
          });
          return;
        }
      }

      resolve(matched);
    }, 200);
  });
}

// ============================================
// Simulate Mouse Click
// ============================================

function simulateClick(el) {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const eventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
  };

  // 正确的事件顺序：pointer → mouse → click
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, pointerId: 1, pointerType: 'mouse' }));
  } catch (e) { /* PointerEvent not supported */ }

  el.dispatchEvent(new MouseEvent('mousedown', eventInit));

  try {
    el.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, pointerId: 1, pointerType: 'mouse' }));
  } catch (e) { /* PointerEvent not supported */ }

  el.dispatchEvent(new MouseEvent('mouseup', eventInit));
  el.dispatchEvent(new MouseEvent('click', eventInit));
}
