
// ============================================
// 自动填写按钮 + 补充输入弹窗
// ============================================

import { extractSimplifiedFormDOMWithRetry, hasFormOnPage } from '../form-extractor.js';
import { fillForm } from '../form-filler.js';
import { sendMessage } from '../../shared/utils.js';
import { MSG } from '../../shared/constants.js';

let floatingBtn = null;

/**
 * 创建浮动的"自动填写"按钮
 */
export function createAutoFillButton() {
  if (floatingBtn) return;

  floatingBtn = document.createElement('div');
  floatingBtn.id = 'form-helper-autofill-btn';
  Object.assign(floatingBtn.style, {
    position: 'fixed',
    bottom: '80px',
    right: '20px',
    width: '52px',
    height: '52px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'grab',
    boxShadow: '0 4px 15px rgba(102,126,234,0.4)',
    zIndex: '2147483646',
    transition: 'box-shadow 0.3s ease, transform 0.2s ease',
    fontSize: '24px',
    userSelect: 'none',
  });
  floatingBtn.textContent = '✨';
  floatingBtn.title = 'AI Auto-fill Form (drag to move)';

  // Hover 效果
  floatingBtn.addEventListener('mouseenter', () => {
    if (!floatingBtn._dragging) {
      floatingBtn.style.transform = 'scale(1.1)';
      floatingBtn.style.boxShadow = '0 6px 25px rgba(102,126,234,0.6)';
    }
  });
  floatingBtn.addEventListener('mouseleave', () => {
    if (!floatingBtn._dragging) {
      floatingBtn.style.transform = 'scale(1)';
      floatingBtn.style.boxShadow = '0 4px 15px rgba(102,126,234,0.4)';
    }
  });

  // 拖动功能
  setupDrag(floatingBtn);

  // 点击事件（在 setupDrag 中通过判断拖动距离来区分点击/拖动）
  document.body.appendChild(floatingBtn);
}

/**
 * 设置浮动按钮的拖动功能
 * 通过判断拖动距离来区分点击和拖动操作
 */
function setupDrag(el) {
  let startX, startY, initialLeft, initialTop;
  let isDragging = false;
  const DRAG_THRESHOLD = 5; // 拖动阈值（像素），小于此值视为点击

  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;

    // 记录当前按钮位置（转换为 left/top 定位）
    const rect = el.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    isDragging = false;
    el._dragging = false;
    el.style.cursor = 'grabbing';
    el.style.transition = 'box-shadow 0.3s ease'; // 拖动时关闭 transform 动画

    const onMouseMove = (e) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!isDragging && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        isDragging = true;
        el._dragging = true;
        // 切换为 left/top 定位
        el.style.left = initialLeft + 'px';
        el.style.top = initialTop + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.boxShadow = '0 8px 30px rgba(102,126,234,0.5)';
      }

      if (isDragging) {
        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        // 限制在窗口范围内
        const maxLeft = window.innerWidth - el.offsetWidth;
        const maxTop = window.innerHeight - el.offsetHeight;
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));

        el.style.left = newLeft + 'px';
        el.style.top = newTop + 'px';
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      el.style.cursor = 'grab';
      el.style.transition = 'box-shadow 0.3s ease, transform 0.2s ease';
      el.style.boxShadow = '0 4px 15px rgba(102,126,234,0.4)';

      if (!isDragging) {
        // 视为点击
        handleAutoFillClick();
      }
      // 延迟重置拖动状态，防止 mouseleave 触发 scale
      setTimeout(() => { el._dragging = false; }, 50);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // 阻止默认拖拽行为
  el.addEventListener('dragstart', (e) => e.preventDefault());
}

/**
 * 处理自动填写按钮点击
 */
async function handleAutoFillClick() {
  try {
    // 1. 提取简化的表单 DOM HTML（带重试，支持 SPA 动态渲染）
    showToast('正在检测表单...', 'info');
    const simplifiedDOM = await extractSimplifiedFormDOMWithRetry(2000);
    if (!simplifiedDOM || simplifiedDOM.trim().length < 50) {
      showToast('当前页面未检测到表单，请确认页面上有可填写的输入框', 'warning');
      return;
    }

    // 2. 获取历史用户画像和记忆
    const ctx = window.__formHelperContext || {};
    const domain = ctx.getCurrentDomain ? ctx.getCurrentDomain() : location.hostname;
    const pageContext = ctx.getPageContext ? ctx.getPageContext() : `标题: ${document.title}\nURL: ${location.href}`;

    const result = await sendMessage(MSG.PREPARE_FILL, { domain });
    if (!result.success) {
      showToast('获取历史数据失败: ' + result.error, 'error');
      return;
    }

    const { profile, memories } = result.data;

    // 3. 弹出补充输入弹窗（展示记忆信息和简化DOM概览）
    const supplement = await showSupplementDialog(profile, simplifiedDOM, memories || []);
    if (supplement === null) return; // 用户取消

    // 4. 显示 Loading 状态
    const loadingOverlay = showLoadingOverlay();

    let fillResult;
    try {
      // 5. 调用 AI 分析 DOM 并生成填充指令
      fillResult = await sendMessage(MSG.EXECUTE_FILL, {
        simplifiedDOM,
        userSupplement: supplement,
        pageContext,
        domain,
      });
    } finally {
      // 移除 Loading
      loadingOverlay.remove();
    }

    if (!fillResult.success) {
      showToast('AI 填充失败: ' + fillResult.error, 'error');
      return;
    }

    const aiFields = fillResult.data.fields || [];
    if (aiFields.length === 0) {
      showToast('AI 未识别到需要填充的字段', 'warning');
      return;
    }

    // 6. 展示 AI 输出结果气泡，等用户确认后执行填充
    const confirmed = await showAIResultBubble(aiFields);
    if (!confirmed) {
      showToast('已取消填充', 'info');
      return;
    }

    // 7. 执行填充
    const count = await fillForm(aiFields);
    showToast(`✅ 已成功填充 ${count} 个字段`, 'success');

  } catch (err) {
    console.error('[FormHelper] 自动填写出错:', err);
    showToast('自动填写出错: ' + err.message, 'error');
  }
}

/**
 * 显示补充输入弹窗
 * @param {Object} profile - 用户画像
 * @param {string} simplifiedDOM - 简化后的 DOM HTML
 * @param {Array} memories - 记忆条目
 * @returns {Promise<string|null>} 用户输入的补充内容，null 表示取消
 */
function showSupplementDialog(profile, simplifiedDOM, memories) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.4)',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });

    const dialog = document.createElement('div');
    Object.assign(dialog.style, {
      background: '#fff',
      borderRadius: '12px',
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      width: '520px',
      maxHeight: '85vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    });

    // 头部
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '16px 20px',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: '#fff',
      borderRadius: '12px 12px 0 0',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    });
    header.innerHTML = `
      <span style="font-weight:600;font-size:15px">AI Auto-fill</span>
    `;
    dialog.appendChild(header);

    // 已有信息区域
    const infoSection = document.createElement('div');
    Object.assign(infoSection.style, {
      padding: '12px 20px',
      background: '#f8f9fa',
      borderBottom: '1px solid #eee',
    });

    const infoTitle = document.createElement('div');
    Object.assign(infoTitle.style, {
      fontSize: '13px',
      fontWeight: '600',
      color: '#333',
      marginBottom: '8px',
    });
      infoTitle.textContent = 'Available Info (from history)';
    infoSection.appendChild(infoTitle);

    const infoContent = document.createElement('div');
    Object.assign(infoContent.style, {
      fontSize: '12px',
      color: '#666',
      lineHeight: '1.8',
      maxHeight: '120px',
      overflowY: 'auto',
    });

    const profileSummary = buildProfileSummary(profile);
    if (profileSummary.length > 0) {
      infoContent.innerHTML = profileSummary.map(item =>
        `<div style="margin-bottom:4px"><div style="color:#999;font-size:11px">${item.label}</div><div style="color:#333;padding:2px 0">${item.value}</div></div>`
      ).join('');
    } else {
      infoContent.innerHTML = '<div style="color:#999">暂无历史数据，请在下方补充您的信息</div>';
    }
    infoSection.appendChild(infoContent);
    dialog.appendChild(infoSection);

    // 记忆条目区域
    if (memories && memories.length > 0) {
      const memSection = document.createElement('div');
      Object.assign(memSection.style, {
        padding: '10px 20px',
        background: '#f0f4ff',
        borderBottom: '1px solid #eee',
      });

      const memTitle = document.createElement('div');
      Object.assign(memTitle.style, {
        fontSize: '13px',
        fontWeight: '600',
        color: '#333',
        marginBottom: '6px',
      });
      memTitle.textContent = 'AI Memory (auto-linked to form fields)';
      memSection.appendChild(memTitle);

      const memList = document.createElement('div');
      Object.assign(memList.style, {
        fontSize: '12px',
        color: '#555',
        lineHeight: '1.8',
        maxHeight: '80px',
        overflowY: 'auto',
      });

      const categoryIcons = { intent: '▸', preference: '▸', fact: '▸', context: '▸' };
      memories.slice(0, 10).forEach(m => {
        const icon = categoryIcons[m.category] || '▸';
        const div = document.createElement('div');
        div.textContent = `${icon} ${m.content}`;
        if (m.expiresAt) {
          const exp = new Date(m.expiresAt);
          const span = document.createElement('span');
          Object.assign(span.style, { color: '#999', fontSize: '11px', marginLeft: '6px' });
          span.textContent = `(至 ${exp.toLocaleDateString('zh-CN')})`;
          div.appendChild(span);
        }
        memList.appendChild(div);
      });

      memSection.appendChild(memList);
      dialog.appendChild(memSection);
    }

    // 表单检测概览（替代旧的字段匹配状态）
    const domPreview = document.createElement('div');
    Object.assign(domPreview.style, {
      padding: '10px 20px',
      borderBottom: '1px solid #eee',
    });
    const previewTitle = document.createElement('div');
    Object.assign(previewTitle.style, {
      fontSize: '13px',
      fontWeight: '600',
      color: '#333',
      marginBottom: '6px',
    });
    previewTitle.textContent = '⚡ 检测到的表单区域';
    domPreview.appendChild(previewTitle);

    const previewInfo = document.createElement('div');
    Object.assign(previewInfo.style, {
      fontSize: '12px',
      color: '#666',
      lineHeight: '1.6',
      padding: '8px 12px',
      background: '#f8f9ff',
      borderRadius: '6px',
      maxHeight: '80px',
      overflowY: 'auto',
    });

    // 从简化 DOM 中快速统计表单元素数量
    const inputCount = (simplifiedDOM.match(/<input/g) || []).length;
    const selectCount = (simplifiedDOM.match(/<select/g) || []).length + (simplifiedDOM.match(/role="combobox"/g) || []).length;
    const textareaCount = (simplifiedDOM.match(/<textarea/g) || []).length;
    const totalFields = inputCount + selectCount + textareaCount;

    // 估算 token 消耗（粗略：1 token ≈ 4 字符英文 / 1.5 字符中文）
    // 清洗画像数据：剔除 changeHistory / lastUpdated / id 等无用字段（与 prompt 实际发送一致）
    const cleanProfile = cleanProfileForEstimate(profile);
    const domTokens = estimateTokens(simplifiedDOM);
    const profileTokens = estimateTokens(JSON.stringify(cleanProfile, null, 2));
    const memoriesTokens = estimateTokens(memories.map(m => m.content).join(' '));
    const promptBaseTokens = 1200; // prompt 模板本身的固定开销
    const totalEstTokens = domTokens + profileTokens + memoriesTokens + promptBaseTokens;

    previewInfo.innerHTML = `
      <div>Detected <strong>${totalFields}</strong> form fields</div>
      <div style="margin-top:4px;color:#999">
        ${inputCount > 0 ? `输入框 ${inputCount} 个` : ''}
        ${selectCount > 0 ? `${inputCount > 0 ? ' · ' : ''}下拉框 ${selectCount} 个` : ''}
        ${textareaCount > 0 ? `${(inputCount + selectCount) > 0 ? ' · ' : ''}文本域 ${textareaCount} 个` : ''}
      </div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #e0e0e0;display:flex;align-items:center;gap:6px">
        <span style="color:#888">Est. Tokens：</span>
        <strong style="color:${totalEstTokens > 10000 ? '#e53935' : totalEstTokens > 5000 ? '#ff9800' : '#4caf50'}">${totalEstTokens.toLocaleString()}</strong>
        <span style="color:#bbb;font-size:11px">(DOM ${domTokens.toLocaleString()} + 画像 ${profileTokens.toLocaleString()} + 记忆 ${memoriesTokens.toLocaleString()} + 模板 ${promptBaseTokens.toLocaleString()})</span>
      </div>
      ${totalEstTokens > 10000 ? '<div style="margin-top:4px;color:#e53935;font-size:11px">⚠️ Token 较多，可能产生较高费用，建议检查页面是否包含过多内容</div>' : ''}
      <div style="margin-top:4px;color:#999">AI 将直接分析表单 DOM 结构来识别字段含义</div>
    `;
    domPreview.appendChild(previewInfo);
    dialog.appendChild(domPreview);

    // 补充输入区域
    const inputSection = document.createElement('div');
    Object.assign(inputSection.style, {
      padding: '12px 20px',
      flex: '1',
    });

    const inputTitle = document.createElement('div');
    Object.assign(inputTitle.style, {
      fontSize: '13px',
      fontWeight: '600',
      color: '#333',
      marginBottom: '8px',
    });
    inputTitle.textContent = 'Supplement or modify info (natural language)';
    inputSection.appendChild(inputTitle);

    // AI 智能生成开关
    const generateToggle = document.createElement('div');
    Object.assign(generateToggle.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '8px',
      padding: '8px 12px',
      background: '#f8f0ff',
      borderRadius: '8px',
      border: '1px solid #e8d5f5',
      cursor: 'pointer',
      userSelect: 'none',
      transition: 'all 0.2s',
    });
    let aiGenerateEnabled = true;
    const toggleCheckbox = document.createElement('div');
    Object.assign(toggleCheckbox.style, {
      width: '36px',
      height: '20px',
      borderRadius: '10px',
      background: '#667eea',
      position: 'relative',
      transition: 'background 0.2s',
      flexShrink: '0',
    });
    const toggleDot = document.createElement('div');
    Object.assign(toggleDot.style, {
      width: '16px',
      height: '16px',
      borderRadius: '50%',
      background: '#fff',
      position: 'absolute',
      top: '2px',
      left: '18px',
      transition: 'left 0.2s',
      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    });
    toggleCheckbox.appendChild(toggleDot);

    const toggleLabel = document.createElement('div');
    toggleLabel.innerHTML = '<span style="font-size:13px;font-weight:600;color:#333">AI Smart Generate</span><br><span style="font-size:11px;color:#888">When enabled, AI generates realistic mock data for empty fields</span>';

    generateToggle.appendChild(toggleCheckbox);
    generateToggle.appendChild(toggleLabel);
    generateToggle.addEventListener('click', () => {
      aiGenerateEnabled = !aiGenerateEnabled;
    toggleCheckbox.style.background = aiGenerateEnabled ? '#667eea' : '#ccc';
      toggleDot.style.left = aiGenerateEnabled ? '18px' : '2px';
      generateToggle.style.background = aiGenerateEnabled ? '#f8f0ff' : '#f5f5f5';
      generateToggle.style.borderColor = aiGenerateEnabled ? '#e8d5f5' : '#ddd';
    });
    inputSection.appendChild(generateToggle);

    const textarea = document.createElement('textarea');
    Object.assign(textarea.style, {
      width: '100%',
      height: '80px',
      border: '1px solid #ddd',
      borderRadius: '8px',
      padding: '10px',
      fontSize: '13px',
      resize: 'vertical',
      outline: 'none',
      fontFamily: 'inherit',
      boxSizing: 'border-box',
      transition: 'border-color 0.2s',
    });
    textarea.placeholder = '例如：地址改成上海市浦东新区陆家嘴环路1000号，邮编200120，公司名叫AI科技有限公司';
    textarea.addEventListener('focus', () => textarea.style.borderColor = '#667eea');
    textarea.addEventListener('blur', () => textarea.style.borderColor = '#ddd');
    inputSection.appendChild(textarea);
    dialog.appendChild(inputSection);

    // 底部按钮
    const footer = document.createElement('div');
    Object.assign(footer.style, {
      padding: '12px 20px',
      borderTop: '1px solid #eee',
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '10px',
    });

    const cancelBtn = document.createElement('button');
    Object.assign(cancelBtn.style, {
      padding: '8px 20px',
      border: 'none',
      borderRadius: '6px',
      background: '#6c757d',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '13px',
    });
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });

    const confirmBtn = document.createElement('button');
    Object.assign(confirmBtn.style, {
      padding: '8px 20px',
      border: 'none',
      borderRadius: '6px',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '600',
    });
    confirmBtn.textContent = 'Confirm Fill';
    confirmBtn.addEventListener('click', () => {
      overlay.remove();
      let supplement = textarea.value.trim();
      if (aiGenerateEnabled) {
        supplement = '[AI_GENERATE] ' + supplement;
      }
      resolve(supplement);
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    setTimeout(() => textarea.focus(), 100);
  });
}

/**
 * 将用户画像转为展示用的摘要列表
 */
function buildProfileSummary(profile) {
  const items = [];

  if (profile.personal) {
    if (profile.personal.name) items.push({ label: '姓名', value: profile.personal.name });
    if (profile.personal.gender) items.push({ label: '性别', value: profile.personal.gender });
    if (profile.personal.birthday) items.push({ label: '生日', value: profile.personal.birthday });
  }
  if (profile.contact) {
    if (profile.contact.phone) items.push({ label: '手机', value: profile.contact.phone });
    if (profile.contact.email) items.push({ label: '邮箱', value: profile.contact.email });
  }
  if (profile.addresses && profile.addresses.length > 0) {
    profile.addresses.forEach(addr => {
      items.push({ label: addr.label || '地址', value: addr.fullAddress || '...' });
    });
  }
  if (profile.work) {
    if (profile.work.company) items.push({ label: '公司', value: profile.work.company });
    if (profile.work.position) items.push({ label: '职位', value: profile.work.position });
  }
  if (profile.education) {
    if (profile.education.school) items.push({ label: '学校', value: profile.education.school });
  }
  if (profile.custom) {
    Object.entries(profile.custom).forEach(([k, v]) => {
      if (v) items.push({ label: k, value: v });
    });
  }

  return items;
}

/**
 * 扁平化 profile 用于字段匹配
 */
function flattenProfile(profile) {
  const list = [];
  const add = (key, label, value) => { if (value) list.push({ key, label, value }); };

  if (profile.personal) {
    add('name', '姓名', profile.personal.name);
    add('gender', '性别', profile.personal.gender);
    add('birthday', '生日', profile.personal.birthday);
  }
  if (profile.contact) {
    add('phone', '手机', profile.contact.phone);
    add('email', '邮箱', profile.contact.email);
  }
  if (profile.work) {
    add('company', '公司', profile.work.company);
    add('position', '职位', profile.work.position);
  }
  if (profile.education) {
    add('school', '学校', profile.education.school);
  }

  return list;
}

/**
 * 显示 Loading 遮罩
 */
function showLoadingOverlay() {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: '#fff',
    borderRadius: '16px',
    padding: '32px 40px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
  });

  // 旋转动画
  const spinner = document.createElement('div');
  Object.assign(spinner.style, {
    width: '40px',
    height: '40px',
    border: '4px solid #e0e0e0',
    borderTop: '4px solid #667eea',
    borderRadius: '50%',
    animation: 'formHelperSpin 0.8s linear infinite',
  });

  // 注入 keyframes
  if (!document.getElementById('form-helper-spin-style')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'form-helper-spin-style';
    styleEl.textContent = '@keyframes formHelperSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
    document.head.appendChild(styleEl);
  }

  const text = document.createElement('div');
  Object.assign(text.style, {
    fontSize: '15px',
    fontWeight: '600',
    color: '#333',
  });
  text.textContent = 'AI is analyzing the form...';

  const subText = document.createElement('div');
  Object.assign(subText.style, {
    fontSize: '12px',
    color: '#999',
  });
  subText.textContent = '请稍候，正在智能匹配最佳填充方案';

  card.appendChild(spinner);
  card.appendChild(text);
  card.appendChild(subText);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  return overlay;
}

/**
 * 展示 AI 输出结果气泡
 * @param {Array} fields - AI 返回的填充指令 [{ selector, label, value, type, options }]
 * @returns {Promise<boolean>} 用户是否确认填充
 */
function showAIResultBubble(fields) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.4)',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });

    const bubble = document.createElement('div');
    Object.assign(bubble.style, {
      background: '#fff',
      borderRadius: '16px',
      boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      width: '480px',
      maxHeight: '80vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    });

    // 头部
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '16px 20px',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    });
    header.innerHTML = `
      <div>
        <div style="font-weight:600;font-size:15px">AI Fill Plan</div>
        <div style="font-size:11px;opacity:0.85">Review below, then confirm to auto-fill the form</div>
      </div>
    `;
    bubble.appendChild(header);

    // 内容区域
    const content = document.createElement('div');
    Object.assign(content.style, {
      padding: '16px 20px',
      overflowY: 'auto',
      flex: '1',
      maxHeight: '50vh',
    });

    const filledFields = fields.filter(f => f.value !== null && f.value !== undefined);
    const skippedFields = fields.filter(f => f.value === null || f.value === undefined);

    if (filledFields.length > 0) {
      filledFields.forEach((field, idx) => {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex',
          flexDirection: 'column',
          padding: '8px 12px',
          background: idx % 2 === 0 ? '#f8f9ff' : '#fff',
          borderRadius: '8px',
          marginBottom: '4px',
          gap: '4px',
        });

        const label = document.createElement('div');
        Object.assign(label.style, {
          fontSize: '11px',
          fontWeight: '600',
          color: '#888',
        });
        label.textContent = field.label || field.selector || '未知字段';

        const val = document.createElement('div');
        Object.assign(val.style, {
          fontSize: '13px',
          color: '#333',
          wordBreak: 'break-all',
          lineHeight: '1.5',
          padding: '4px 8px',
          background: '#e8f5e9',
          borderRadius: '4px',
          border: '1px solid #c8e6c9',
          minHeight: '24px',
        });
        val.textContent = String(field.value);

        row.appendChild(label);
        row.appendChild(val);
        content.appendChild(row);
      });
    }

    // 未填充的字段
    if (skippedFields.length > 0) {
      const divider = document.createElement('div');
      Object.assign(divider.style, {
        fontSize: '12px',
        color: '#999',
        padding: '8px 0 4px 0',
        borderTop: '1px dashed #ddd',
        marginTop: '8px',
      });
      divider.textContent = '⚠️ 以下字段未能填充';
      content.appendChild(divider);

      skippedFields.forEach(field => {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex',
          alignItems: 'center',
          padding: '6px 12px',
          gap: '12px',
          fontSize: '12px',
          color: '#999',
        });
        row.textContent = `${field.label || field.selector}: 未填充`;
        content.appendChild(row);
      });
    }

    bubble.appendChild(content);

    // 底部统计 + 按钮
    const footer = document.createElement('div');
    Object.assign(footer.style, {
      padding: '12px 20px',
      borderTop: '1px solid #eee',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    });

    const stats = document.createElement('div');
    Object.assign(stats.style, {
      fontSize: '12px',
      color: '#888',
    });
    stats.textContent = `共 ${fields.length} 个字段，将填充 ${filledFields.length} 个`;

    const btnGroup = document.createElement('div');
    Object.assign(btnGroup.style, {
      display: 'flex',
      gap: '10px',
    });

    const cancelBtn = document.createElement('button');
    Object.assign(cancelBtn.style, {
      padding: '8px 18px',
      border: 'none',
      borderRadius: '6px',
      background: '#6c757d',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '13px',
    });
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });

    const confirmBtn = document.createElement('button');
    Object.assign(confirmBtn.style, {
      padding: '8px 18px',
      border: 'none',
      borderRadius: '6px',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '600',
    });
    confirmBtn.textContent = '✅ 确认填充';
    confirmBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });

    btnGroup.appendChild(cancelBtn);
    btnGroup.appendChild(confirmBtn);
    footer.appendChild(stats);
    footer.appendChild(btnGroup);
    bubble.appendChild(footer);

    overlay.appendChild(bubble);
    document.body.appendChild(overlay);
  });
}

/**
 * 清洗画像数据用于 token 估算（与 prompt-templates.js 中 cleanProfileForPrompt 逻辑一致）
 * 剔除 changeHistory / lastUpdated / id 等对 AI 填充无用的字段
 */
function cleanProfileForEstimate(profile) {
  if (!profile) return {};
  const { changeHistory, lastUpdated, id, ...rest } = profile;
  const cleaned = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/**
 * 粗略估算文本的 Token 数量
 * 规则：英文约 4 字符 / token，中文约 1.5 字符 / token
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  // 分离中文和非中文部分
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const otherChars = text.length - chineseChars;
  // 中文 ~1.5字符/token, 英文/符号 ~4字符/token
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 显示 Toast 提示
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  const colors = {
    info: '#667eea',
    success: '#4CAF50',
    warning: '#FF9800',
    error: '#f44336',
  };
  Object.assign(toast.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    padding: '12px 20px',
    borderRadius: '8px',
    background: colors[type] || colors.info,
    color: '#fff',
    fontSize: '14px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: '2147483647',
    transition: 'all 0.3s ease',
    opacity: '0',
    transform: 'translateY(-10px)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  });
  toast.textContent = message;
  document.body.appendChild(toast);

  // 动画进入
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  // 自动消失
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export { showToast };
