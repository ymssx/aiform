
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
  return `标题: ${document.title}\nURL: ${location.href}\n域名: ${location.hostname}`;
}

/**
 * 初始化插件
 */
async function init() {
  console.log('[FormHelper] Content Script 初始化...');

  // 始终创建浮动按钮（不依赖 background 通信）
  createAutoFillButton();

  try {
    // 检查配置
    const configResult = await sendMessage(MSG.GET_CONFIG);
    if (!configResult || !configResult.success) {
      console.warn('[FormHelper] 获取配置失败，使用默认行为');
      initFormObserver(handleFormSubmit);
      return;
    }

    const config = configResult.data;

    // 检查域名白名单（白名单为空表示所有域名都允许）
    if (config.enabledDomains && config.enabledDomains.length > 0) {
      const domain = getCurrentDomain();
      if (!config.enabledDomains.some(d => domain.includes(d))) {
        console.log('[FormHelper] 当前域名不在白名单中，跳过表单监听');
        return;
      }
    }

    // 启动表单监听（如果开启了自动检测）
    if (config.autoDetect !== false) {
      initFormObserver(handleFormSubmit);
    }
  } catch (err) {
    console.error('[FormHelper] 初始化出错:', err);
    initFormObserver(handleFormSubmit);
  }

  console.log('[FormHelper] 初始化完成');
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

  console.log('[FormHelper] 检测到表单提交，字段数:', rawFields.length);

  try {
    // 检查是否配置了 API Key
    const configResult = await sendMessage(MSG.GET_CONFIG);
    if (!configResult.data.apiKey) {
      showToast('请先在插件设置中配置 API Key', 'warning');
      return;
    }

    // 调用 AI 结构化提取（传入页面上下文）
    showToast('AI 正在分析表单数据...', 'info');

    const extractResult = await sendMessage(MSG.EXTRACT_FORM, {
      rawFields,
      pageContext: getPageContext(),
      domain: getCurrentDomain(),
    });

    if (!extractResult.success) {
      showToast('AI 分析失败: ' + extractResult.error, 'error');
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
        showToast(`✅ 表单信息已保存${memCount > 0 ? `，提取了 ${memCount} 条记忆` : ''}`, 'success');
      } else {
        showToast('保存失败: ' + saveResult.error, 'error');
      }
    }
  } catch (err) {
    console.error('[FormHelper] 处理表单提交出错:', err);
    showToast('处理出错: ' + err.message, 'error');
  }
}

// 将 getPageContext 和 getCurrentDomain 暴露给 autofill-button.js 使用
window.__formHelperContext = { getPageContext, getCurrentDomain };

// 启动
init();
