
// ============================================
// 确认弹窗 - 表单提交后询问是否保存
// ============================================

/**
 * 显示确认保存弹窗
 * @param {Object} structuredData - AI 结构化后的数据 { formName, fields }
 * @returns {Promise<boolean>} 用户是否确认保存
 */
export function showConfirmDialog(structuredData) {
  return new Promise((resolve) => {
    const overlay = createOverlay();
    const dialog = createDialogElement(structuredData, (confirmed) => {
      overlay.remove();
      resolve(confirmed);
    });
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

function createOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'form-helper-confirm-overlay';
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
  return overlay;
}

function createDialogElement(data, onClose) {
  const dialog = document.createElement('div');
  Object.assign(dialog.style, {
    background: '#fff',
    borderRadius: '12px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    width: '480px',
    maxHeight: '80vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    animation: 'formHelperFadeIn 0.2s ease-out',
  });

  // 添加动画样式
  const styleTag = document.createElement('style');
  styleTag.textContent = `
    @keyframes formHelperFadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
  `;
  dialog.appendChild(styleTag);

  // 头部
  const header = document.createElement('div');
  Object.assign(header.style, {
    padding: '16px 20px',
    borderBottom: '1px solid #eee',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: '#fff',
    borderRadius: '12px 12px 0 0',
  });
  header.innerHTML = `
    <span style="font-size:20px">🤖</span>
    <span style="font-weight:600;font-size:15px">AI 表单助手 - 检测到表单提交</span>
  `;
  dialog.appendChild(header);

  // 表单名称
  const formNameDiv = document.createElement('div');
  Object.assign(formNameDiv.style, {
    padding: '12px 20px',
    background: '#f8f9fa',
    fontSize: '13px',
    color: '#666',
  });
  formNameDiv.textContent = `📋 ${data.formName || '表单数据'}`;
  dialog.appendChild(formNameDiv);

  // 字段列表
  const fieldList = document.createElement('div');
  Object.assign(fieldList.style, {
    padding: '12px 20px',
    overflowY: 'auto',
    maxHeight: '300px',
    flex: '1',
  });

  if (data.fields && data.fields.length > 0) {
    data.fields.forEach(field => {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        padding: '8px 0',
        borderBottom: '1px solid #f0f0f0',
        fontSize: '13px',
        gap: '8px',
      });

      const categoryBadge = document.createElement('span');
      const categoryColors = {
        personal: '#4CAF50',
        contact: '#2196F3',
        address: '#FF9800',
        work: '#9C27B0',
        education: '#00BCD4',
        other: '#607D8B',
      };
      Object.assign(categoryBadge.style, {
        background: categoryColors[field.category] || '#607D8B',
        color: '#fff',
        padding: '1px 6px',
        borderRadius: '4px',
        fontSize: '11px',
        flexShrink: '0',
        height: 'fit-content',
      });
      categoryBadge.textContent = field.category;

      const label = document.createElement('span');
      Object.assign(label.style, {
        color: '#666',
        minWidth: '80px',
        flexShrink: '0',
      });
      label.textContent = field.label + ':';

      const value = document.createElement('span');
      Object.assign(value.style, {
        color: '#333',
        fontWeight: '500',
        wordBreak: 'break-all',
      });
      value.textContent = field.value;

      row.appendChild(categoryBadge);
      row.appendChild(label);
      row.appendChild(value);
      fieldList.appendChild(row);
    });
  } else {
    fieldList.textContent = '未提取到有效字段';
  }
  dialog.appendChild(fieldList);

  // 底部按钮
  const footer = document.createElement('div');
  Object.assign(footer.style, {
    padding: '12px 20px',
    borderTop: '1px solid #eee',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
  });

  const cancelBtn = createButton('忽略', '#6c757d', () => onClose(false));
  const confirmBtn = createButton('✅ 保存信息', '#667eea', () => onClose(true));
  Object.assign(confirmBtn.style, { fontWeight: '600' });

  footer.appendChild(cancelBtn);
  footer.appendChild(confirmBtn);
  dialog.appendChild(footer);

  return dialog;
}

function createButton(text, bgColor, onClick) {
  const btn = document.createElement('button');
  Object.assign(btn.style, {
    padding: '8px 20px',
    border: 'none',
    borderRadius: '6px',
    background: bgColor,
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'opacity 0.2s',
  });
  btn.textContent = text;
  btn.addEventListener('mouseenter', () => btn.style.opacity = '0.85');
  btn.addEventListener('mouseleave', () => btn.style.opacity = '1');
  btn.addEventListener('click', onClick);
  return btn;
}
