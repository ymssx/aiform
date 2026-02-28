
// ============================================
// Content Script 入口
// ============================================

import { MSG } from '../shared/constants.js';
import { sendMessage, getCurrentDomain } from '../shared/utils.js';
import { initFormObserver } from './form-observer.js';
import { extractFormFields } from './form-extractor.js';
import { showConfirmDialog } from './ui/confirm-dialog.js';
import { createAutoFillButton, showToast } from './ui/autofill-button.js';

// 防止重复提交检测
let lastSubmitTime = 0;
const DEBOUNCE_MS = 3000;

/**
 * 获取页面上下文信息（传给 AI 减少歧义）
 */
function getPageContext() {
  return `Title: ${document.title}\nURL: ${location.href}\nDomain: ${location.hostname}`;
}

/**
 * 初始化插件
 */
async function init() {
  console.log('[FormHelper] Content Script initializing...');

  // 始终创建浮动按钮（不依赖 background 通信）
  createAutoFillButton();

  try {
    // 检查配置
    const configResult = await sendMessage(MSG.GET_CONFIG);
    if (!configResult || !configResult.success) {
      console.warn('[FormHelper] Failed to get config, using default behavior');
      initFormObserver(handleFormSubmit);
      return;
    }

    const config = configResult.data;

    // 检查域名白名单（白名单为空表示所有域名都允许）
    if (config.enabledDomains && config.enabledDomains.length > 0) {
      const domain = getCurrentDomain();
      if (!config.enabledDomains.some(d => domain.includes(d))) {
      console.log('[FormHelper] Current domain not in whitelist, skipping form listener');
        return;
      }
    }

    // 启动表单监听（如果开启了自动检测）
    if (config.autoDetect !== false) {
      initFormObserver(handleFormSubmit);
    }
  } catch (err) {
    console.error('[FormHelper] Initialization error:', err);
    initFormObserver(handleFormSubmit);
  }

  console.log('[FormHelper] Initialization complete');
}

/**
 * 表单提交回调
 */
async function handleFormSubmit(rawFields, formElement) {
  // 防抖
  const now = Date.now();
  if (now - lastSubmitTime < DEBOUNCE_MS) return;
  lastSubmitTime = now;

  if (rawFields.length === 0) return;

  console.log('[FormHelper] Form submission detected, field count:', rawFields.length);

  try {
    // 检查是否配置了 API Key
    const configResult = await sendMessage(MSG.GET_CONFIG);
    if (!configResult.data.apiKey) {
      showToast('Please configure API Key in extension settings first', 'warning');
      return;
    }

    // 调用 AI 结构化提取（传入页面上下文）
    showToast('AI is analyzing form data...', 'info');

    const extractResult = await sendMessage(MSG.EXTRACT_FORM, {
      rawFields,
      pageContext: getPageContext(),
      domain: getCurrentDomain(),
    });

    if (!extractResult.success) {
      showToast('AI analysis failed: ' + extractResult.error, 'error');
      return;
    }

    const structuredData = extractResult.data;

    // 弹窗确认
    const confirmed = await showConfirmDialog(structuredData);

    if (confirmed) {
      // 保存记录
      const saveResult = await sendMessage(MSG.SAVE_RECORD, {
        record: {
          domain: getCurrentDomain(),
          url: location.href,
          pageTitle: document.title,
          formName: structuredData.formName,
          fields: structuredData.fields,
          rawData: rawFields,
        },
      });

      if (saveResult.success) {
        // 显示记忆提取结果
        const memCount = structuredData.memories?.length || 0;
        showToast(`✅ Form data saved${memCount > 0 ? `, extracted ${memCount} memories` : ''}`, 'success');
      } else {
        showToast('Save failed: ' + saveResult.error, 'error');
      }
    }
  } catch (err) {
    console.error('[FormHelper] Form submission processing error:', err);
    showToast('Processing error: ' + err.message, 'error');
  }
}

// 将 getPageContext 和 getCurrentDomain 暴露给 autofill-button.js 使用
window.__formHelperContext = { getPageContext, getCurrentDomain };

// 启动
init();
