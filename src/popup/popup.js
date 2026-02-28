
// ============================================
// Popup 页面交互逻辑
// ============================================

import { ICONS } from '../shared/icons.js';

const MSG = {
  GET_CONFIG: 'GET_CONFIG',
  SAVE_CONFIG: 'SAVE_CONFIG',
  GET_PROFILE: 'GET_PROFILE',
  SAVE_PROFILE: 'SAVE_PROFILE',
  GET_RECORDS: 'GET_RECORDS',
  DELETE_RECORD: 'DELETE_RECORD',
  UPDATE_RECORD: 'UPDATE_RECORD',
  GET_MEMORIES: 'GET_MEMORIES',
  DELETE_MEMORY: 'DELETE_MEMORY',
  CLEAR_ALL: 'CLEAR_ALL',
};

// ========== Tab 切换 ==========

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');

    // 切换时加载数据
    if (tab.dataset.tab === 'profile') loadProfile();
    if (tab.dataset.tab === 'history') loadHistory();
  });
});

// ========== 预设快捷选择 ==========

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const endpoint = btn.dataset.endpoint;
    const model = btn.dataset.model;
    const keyUrl = btn.dataset.keyurl;
    document.getElementById('apiEndpoint').value = endpoint;
    document.getElementById('modelName').value = model;
    // 高亮当前选中的预设
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // 更新 API Key 直达链接
    updateApiKeyLink(keyUrl);
showPopupToast('Preset applied. Please enter API Key and save.', '#667eea');
  });
});

function updateApiKeyLink(keyUrl) {
  const linkContainer = document.getElementById('apiKeyLink');
  const linkAnchor = document.getElementById('apiKeyLinkAnchor');
  if (keyUrl) {
    linkAnchor.href = keyUrl;
    linkAnchor.textContent = 'Get API Key \u2192';
    linkContainer.style.display = 'block';
  } else {
    linkContainer.style.display = 'none';
  }
}

// ========== 设置管理 ==========

async function loadConfig() {
  const result = await chrome.runtime.sendMessage({ type: MSG.GET_CONFIG });
  if (!result.success) return;

  const config = result.data;
  document.getElementById('apiEndpoint').value = config.apiEndpoint || '';
  document.getElementById('modelName').value = config.modelName || '';
  document.getElementById('apiKey').value = config.apiKey || '';
  document.getElementById('autoDetect').checked = config.autoDetect !== false;
  document.getElementById('quickMode').checked = config.quickMode === true;
  document.getElementById('enabledDomains').value = (config.enabledDomains || []).join(', ');

  // 自动高亮匹配的预设按钮
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.remove('active');
    if (config.apiEndpoint && config.apiEndpoint === btn.dataset.endpoint) {
      btn.classList.add('active');
      // 加载时也显示对应的 API Key 直达链接
      updateApiKeyLink(btn.dataset.keyurl);
    }
  });

  updateStatus(config);
}

function updateStatus(config) {
  const indicator = document.getElementById('status-indicator');
  if (config.apiKey) {
    indicator.className = 'status status-ok';
    indicator.textContent = `✅ Configured · ${config.modelName || 'unknown'} · Ready`;
  } else {
    indicator.className = 'status status-warn';
    indicator.textContent = '⚠️ API Key not configured';
  }
}

document.getElementById('saveConfigBtn').addEventListener('click', async () => {
  const domains = document.getElementById('enabledDomains').value
    .split(',').map(s => s.trim()).filter(Boolean);

  const config = {
    apiEndpoint: document.getElementById('apiEndpoint').value.trim(),
    modelName: document.getElementById('modelName').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    autoDetect: document.getElementById('autoDetect').checked,
    quickMode: document.getElementById('quickMode').checked,
    enabledDomains: domains,
  };

  const result = await chrome.runtime.sendMessage({ type: MSG.SAVE_CONFIG, data: config });
  if (result.success) {
showPopupToast('Settings saved', '#667eea');
    updateStatus(config);
  } else {
    showPopupToast('Save failed', '#f44336');
  }
});

document.getElementById('clearAllBtn').addEventListener('click', async () => {
  if (!confirm('Are you sure you want to clear all data? This includes user profile and history records.')) return;
  await chrome.runtime.sendMessage({ type: MSG.CLEAR_ALL });
showPopupToast('All data cleared', '#667eea');
  loadConfig();
});

// ========== 用户画像（三分类汇总视图） ==========

// 当前画像数据的缓存
let currentProfile = null;
// 当前记忆数据的缓存
let currentMemories = [];

async function loadProfile() {
  const [profileResult, memoriesResult] = await Promise.all([
    chrome.runtime.sendMessage({ type: MSG.GET_PROFILE }),
    chrome.runtime.sendMessage({ type: MSG.GET_MEMORIES }),
  ]);
  const container = document.getElementById('profile-container');

  currentProfile = (profileResult.success && profileResult.data) ? profileResult.data : null;
  currentMemories = (memoriesResult.success && memoriesResult.data) ? memoriesResult.data : [];

  if (!currentProfile && currentMemories.length === 0) {
    container.innerHTML = '<div class="empty-state">No data yet</div>';
    return;
  }

  if (!currentProfile) {
    currentProfile = { personal: {}, contact: {}, addresses: [], work: {}, education: {}, preferences: {}, custom: {} };
  }

  renderProfileSummary(container);
}

/**
 * 渲染三分类汇总视图
 */
function renderProfileSummary(container) {
  let html = '';

  // ========== 1. 基本信息（不变的用户信息） ==========
  html += '<div class="info-category">';
  html += '<div class="info-category-header" data-section="basic">';
  html += `<span class="info-category-icon">${ICONS.pin}</span>`;
    html += '<span class="info-category-title">Basic Info</span>';
    html += '<span class="info-category-desc">Stable personal data</span>';
  html += '<span class="info-category-toggle">▾</span>';
  html += '</div>';
  html += '<div class="info-category-body" id="section-basic">';

  const profile = currentProfile;

  // 个人信息
  html += buildEditableSection(`${ICONS.user} Personal`, 'personal', profile.personal || {}, {
    name: 'Name', gender: 'Gender', birthday: 'Birthday', idCard: 'ID Card',
  });

  // 联系方式
  html += buildEditableSection(`${ICONS.phone} Contact`, 'contact', profile.contact || {}, {
    phone: 'Phone', email: 'Email', wechat: 'WeChat',
  });

  // 地址
  html += '<div class="profile-section">';
  html += `<div class="profile-title">${ICONS.mapPin} Address</div>`;
  if (profile.addresses && profile.addresses.length > 0) {
    profile.addresses.forEach((addr, idx) => {
      html += `<div class="profile-edit-row">
        <label class="profile-edit-label">${addr.label || 'Address ' + (idx + 1)}</label>
        <input class="profile-edit-input" data-category="address" data-index="${idx}" data-key="fullAddress" value="${escapeAttr(addr.fullAddress || '')}">
      </div>`;
    });
  } else {
    html += `<div class="profile-edit-row">
      <label class="profile-edit-label">Address</label>
      <input class="profile-edit-input" data-category="address" data-index="0" data-key="fullAddress" value="" placeholder="None yet">
    </div>`;
  }
  html += '</div>';

  // 工作
  html += buildEditableSection(`${ICONS.briefcase} Work`, 'work', profile.work || {}, {
    company: 'Company', department: 'Department', position: 'Position', workPhone: 'Work Phone',
  });

  // 教育
  html += buildEditableSection(`${ICONS.graduationCap} Education`, 'education', profile.education || {}, {
    school: 'School', major: 'Major', degree: 'Degree', graduationYear: 'Graduation Year',
  });

  // 自定义字段（过滤掉不属于基本信息的字段）
  const custom = profile.custom || {};
  const filteredCustom = filterProfileCustomFields(custom);
  if (Object.keys(filteredCustom).length > 0) {
    html += buildEditableSection(`${ICONS.layers} Other`, 'custom', filteredCustom, null);
  }

  html += `<button id="saveProfileBtn" class="btn btn-primary" style="margin-top:8px">${ICONS.save} Save Basic Info</button>`;
  html += '</div></div>'; // 关闭 basic section

  // ========== 2. 短期信息（有时效性的意图/上下文） ==========
  const shortTermMemories = currentMemories.filter(m => m.category === 'intent' || m.category === 'context');
  html += '<div class="info-category">';
  html += '<div class="info-category-header" data-section="short">';
  html += `<span class="info-category-icon">${ICONS.clock}</span>`;
    html += '<span class="info-category-title">Short-term</span>';
    html += `<span class="info-category-desc">Recent plans & context (${shortTermMemories.length})</span>`;
  html += '<span class="info-category-toggle">▾</span>';
  html += '</div>';  html += '<div class="info-category-body" id="section-short">';

  if (shortTermMemories.length > 0) {
    shortTermMemories.forEach(m => {
      html += buildMemoryCard(m);
    });
  } else {
    html += '<div class="empty-state" style="padding:12px;font-size:12px">No short-term info yet. AI extracts from form submissions.</div>';
  }

  html += '</div></div>'; // 关闭 short section

  // ========== 3. 长期信息（持久偏好/事实） ==========
  const longTermMemories = currentMemories.filter(m => m.category === 'preference' || m.category === 'fact');
  html += '<div class="info-category">';
  html += '<div class="info-category-header" data-section="long">';
  html += `<span class="info-category-icon">${ICONS.gem}</span>`;
    html += '<span class="info-category-title">Long-term</span>';
    html += `<span class="info-category-desc">Preferences & lasting facts (${longTermMemories.length})</span>`;
  html += '<span class="info-category-toggle">▾</span>';
  html += '</div>';
  html += '<div class="info-category-body" id="section-long">';

  if (longTermMemories.length > 0) {
    longTermMemories.forEach(m => {
      html += buildMemoryCard(m);
    });
  } else {
    html += '<div class="empty-state" style="padding:12px;font-size:12px">No long-term info yet. AI extracts from form submissions.</div>';
  }

  html += '</div></div>'; // 关闭 long section

  // 最后更新时间
  if (profile.lastUpdated) {
    html += `<div style="text-align:center;font-size:11px;color:#999;margin-top:10px">Last updated: ${new Date(profile.lastUpdated).toLocaleString()}</div>`;
  }

  container.innerHTML = html;

  // 绑定折叠/展开
  container.querySelectorAll('.info-category-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.dataset.section;
      const body = document.getElementById(`section-${section}`);
      const toggle = header.querySelector('.info-category-toggle');
      if (body.classList.contains('collapsed')) {
        body.classList.remove('collapsed');
        toggle.textContent = '▾';
      } else {
        body.classList.add('collapsed');
        toggle.textContent = '▸';
      }
    });
  });

  // 绑定保存基本信息
  const saveBtn = document.getElementById('saveProfileBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveProfileFromUI);

  // 绑定记忆删除按钮
  container.querySelectorAll('.memory-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!confirm('Delete this memory?')) return;
      await chrome.runtime.sendMessage({ type: MSG.DELETE_MEMORY, data: { id } });
showPopupToast('Memory deleted', '#667eea');
      loadProfile(); // 重新加载
    });
  });
}

/**
 * 构建记忆卡片 HTML
 */
function buildMemoryCard(memory) {
  const categoryLabels = {
    intent: `${ICONS.calendarCheck} Plan`,
    preference: `${ICONS.heart} Preference`,
    fact: `${ICONS.fileText} Fact`,
    context: `${ICONS.messageCircle} Context`,
  };
  const categoryLabel = categoryLabels[memory.category] || memory.category;
  const createdTime = memory.createdAt ? new Date(memory.createdAt).toLocaleString() : '';
  const expiresText = memory.expiresAt
    ? `Expires: ${new Date(memory.expiresAt).toLocaleDateString()}`
    : 'Never expires';
  const isExpired = memory.expiresAt && memory.expiresAt < Date.now();

  return `<div class="memory-card ${isExpired ? 'memory-expired' : ''}">
    <div class="memory-card-header">
      <span class="memory-card-category">${categoryLabel}</span>
      <span class="memory-card-time">${createdTime}</span>
      <span class="memory-delete" data-id="${memory.id}" title="Delete">✕</span>
    </div>
    <div class="memory-card-content">${escapeAttr(memory.content)}</div>
    <div class="memory-card-footer">
      <span class="memory-card-expires ${isExpired ? 'expired' : ''}">${expiresText}</span>
      ${memory.domain && memory.domain !== '*' ? `<span class="memory-card-domain">${escapeAttr(memory.domain)}</span>` : ''}
    </div>
  </div>`;
}

/**
 * 构建可编辑的分类区域
 * @param {string} title - 分类标题
 * @param {string} category - 分类 key (personal/contact/work/education/custom)
 * @param {Object} data - 当前数据
 * @param {Object|null} fieldDefs - 字段定义 {key: label}，null 表示使用 data 的 key 作为 label
 */
function buildEditableSection(title, category, data, fieldDefs) {
  let html = `<div class="profile-section"><div class="profile-title">${title}</div>`;

  if (fieldDefs) {
    // 有预定义字段：按定义的字段顺序展示，保证所有字段都可编辑
    for (const [key, label] of Object.entries(fieldDefs)) {
      const value = data[key] || '';
      html += `<div class="profile-edit-row">
        <label class="profile-edit-label">${label}</label>
        <input class="profile-edit-input" data-category="${category}" data-key="${key}" value="${escapeAttr(value)}" placeholder="Not filled">
      </div>`;
    }
    // 也展示不在预定义中但已有数据的字段
    for (const [key, value] of Object.entries(data)) {
      if (!value || fieldDefs[key]) continue;
      html += `<div class="profile-edit-row">
        <label class="profile-edit-label">${formatLabel(key)}</label>
        <input class="profile-edit-input" data-category="${category}" data-key="${key}" value="${escapeAttr(value)}" placeholder="Not filled">
      </div>`;
    }
  } else {
    // 自定义字段：直接展示所有已有数据
    for (const [key, value] of Object.entries(data)) {
      if (!value) continue;
      html += `<div class="profile-edit-row">
        <label class="profile-edit-label">${formatLabel(key)}</label>
        <input class="profile-edit-input" data-category="${category}" data-key="${key}" value="${escapeAttr(value)}">
      </div>`;
    }
  }

  html += '</div>';
  return html;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 将 camelCase / snake_case / kebab-case 的 key 转为可读的 Title Case label
 * 例如: idCard -> Id Card, work_phone -> Work Phone, full-name -> Full Name
 */
function formatLabel(key) {
  if (!key) return '';
  return key
    // 先处理 camelCase: 在大写字母前插入空格
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // 处理 snake_case 和 kebab-case
    .replace(/[_-]/g, ' ')
    // 每个单词首字母大写
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

/**
 * 过滤 custom 字段，排除不属于个人基本信息的字段
 * 例如：表单中的 message、subject、comment 等内容型字段不应出现在 Profile 基本信息中
 */
function filterProfileCustomFields(custom) {
  // 不属于个人信息的字段关键词（小写匹配）
  const excludePatterns = [
    'message', 'subject', 'comment', 'description', 'content', 'body',
    'note', 'remark', 'feedback', 'question', 'inquiry', 'detail',
    'reason', 'purpose', 'requirement', 'suggestion', 'opinion',
    'text', 'textarea', 'captcha', 'verify', 'code', 'token',
    'csrf', 'password', 'submit', 'action',
  ];
  const filtered = {};
  for (const [key, value] of Object.entries(custom)) {
    const lowerKey = key.toLowerCase();
    const shouldExclude = excludePatterns.some(pattern => lowerKey.includes(pattern));
    if (!shouldExclude) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * 从 UI 收集数据并保存到 storage
 */
async function saveProfileFromUI() {
  const profile = currentProfile ? { ...currentProfile } : {
    id: 'default_user',
    personal: {},
    contact: {},
    addresses: [],
    work: {},
    education: {},
    preferences: {},
    custom: {},
    changeHistory: currentProfile?.changeHistory || [],
  };

  // 收集所有编辑框的值
  document.querySelectorAll('.profile-edit-input').forEach(input => {
    const category = input.dataset.category;
    const key = input.dataset.key;
    const value = input.value.trim();

    if (category === 'address') {
      const index = parseInt(input.dataset.index, 10);
      if (!profile.addresses) profile.addresses = [];
      if (!profile.addresses[index]) {
        profile.addresses[index] = { label: 'Default Address' };
      }
      profile.addresses[index][key] = value;
      profile.addresses[index].fullAddress = value;
    } else {
      if (!profile[category]) profile[category] = {};
      if (value) {
        profile[category][key] = value;
      } else {
        delete profile[category][key];
      }
    }
  });

  // 过滤掉空地址
  profile.addresses = (profile.addresses || []).filter(a => a.fullAddress);

  try {
    await chrome.runtime.sendMessage({ type: MSG.SAVE_PROFILE, data: profile });
    currentProfile = profile;
showPopupToast('Profile saved', '#667eea');
  } catch (e) {
    showPopupToast('Save failed: ' + e.message, '#f44336');
  }
}

// ========== 历史记录 ==========

// 缓存当前加载的记录列表
let currentRecords = [];

async function loadHistory() {
  const result = await chrome.runtime.sendMessage({ type: MSG.GET_RECORDS });
  const container = document.getElementById('history-container');

  if (!result.success || !result.data || result.data.length === 0) {
    currentRecords = [];
    container.innerHTML = '<div class="empty-state">No history records</div>';
    return;
  }

  currentRecords = result.data;
  renderHistoryList(container);
}

function renderHistoryList(container) {
  let html = '';
  currentRecords.forEach(record => {
    const time = new Date(record.timestamp).toLocaleString();
    const fieldCount = record.fields ? record.fields.length : 0;
    html += `
      <div class="record-item" data-id="${record.id}">
        <div class="record-actions">
          <span class="record-action record-view" data-id="${record.id}" title="View">${ICONS.eye}</span>
          <span class="record-action record-edit" data-id="${record.id}" title="Edit">${ICONS.pencil}</span>
          <span class="record-action record-delete" data-id="${record.id}" title="Delete">${ICONS.trash}</span>
        </div>
        <div class="record-name">${escapeAttr(record.formName || 'Unnamed Form')}</div>
        <div class="record-meta">${escapeAttr(record.domain || '')} · ${fieldCount} fields · ${time}</div>
      </div>
    `;
  });
  container.innerHTML = html;

  // 绑定查看事件
  container.querySelectorAll('.record-view').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const record = currentRecords.find(r => r.id === btn.dataset.id);
      if (record) renderRecordDetail(record, container, false);
    });
  });

  // 绑定编辑事件
  container.querySelectorAll('.record-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const record = currentRecords.find(r => r.id === btn.dataset.id);
      if (record) renderRecordDetail(record, container, true);
    });
  });

  // 绑定删除事件
  container.querySelectorAll('.record-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Are you sure you want to delete this record?')) return;
      await chrome.runtime.sendMessage({ type: MSG.DELETE_RECORD, data: { id: btn.dataset.id } });
      loadHistory();
    });
  });
}

/**
 * 渲染记录详情/编辑视图
 * @param {Object} record - 记录对象
 * @param {HTMLElement} container - 容器元素
 * @param {boolean} editable - 是否可编辑
 */
function renderRecordDetail(record, container, editable) {
  const time = new Date(record.timestamp).toLocaleString();
  let html = '';

  // 返回按钮
  html += '<div class="detail-header">';
  html += '<span class="detail-back" id="backToList">← Back</span>';
  html += `<span class="detail-mode">${editable ? ICONS.pencil + ' Edit Mode' : ICONS.eye + ' View Mode'}</span>`;
  html += '</div>';

  // 基本信息
  html += '<div class="detail-section">';
  html += `<div class="detail-title">${ICONS.clipboardList} Basic Info</div>`;
  if (editable) {
    html += `<div class="detail-row">
      <label class="detail-label">Form Name</label>
      <input class="detail-input" id="edit-formName" value="${escapeAttr(record.formName || '')}">
    </div>`;
  } else {
    html += `<div class="detail-row"><span class="detail-label">Form Name</span><span class="detail-value">${escapeAttr(record.formName || 'Unnamed Form')}</span></div>`;
  }
  html += `<div class="detail-row"><span class="detail-label">Domain</span><span class="detail-value">${escapeAttr(record.domain || '-')}</span></div>`;
  html += `<div class="detail-row"><span class="detail-label">Page</span><span class="detail-value" style="word-break:break-all">${escapeAttr(record.pageTitle || '-')}</span></div>`;
  html += `<div class="detail-row"><span class="detail-label">Time</span><span class="detail-value">${time}</span></div>`;
  html += '</div>';

  // 字段详情
  if (record.fields && record.fields.length > 0) {
    html += '<div class="detail-section">';
  html += `<div class="detail-title">${ICONS.penLine} Fields (${record.fields.length})</div>`;
    record.fields.forEach((field, idx) => {
      if (editable) {
        html += `<div class="detail-field-row">
          <div class="detail-field-header">
            <span class="detail-field-label-tag">${escapeAttr(field.label || field.key || 'Field ' + (idx + 1))}</span>
            <span class="detail-field-category">${escapeAttr(field.category || 'custom')}</span>
          </div>
          <input class="detail-input detail-field-value" data-field-index="${idx}" value="${escapeAttr(field.value || '')}">
        </div>`;
      } else {
        html += `<div class="detail-field-row">
          <div class="detail-field-header">
            <span class="detail-field-label-tag">${escapeAttr(field.label || field.key || 'Field ' + (idx + 1))}</span>
            <span class="detail-field-category">${escapeAttr(field.category || 'custom')}</span>
          </div>
          <div class="detail-field-value-text">${escapeAttr(field.value || '-')}</div>
        </div>`;
      }
    });
    html += '</div>';
  }

  // URL 信息
  if (record.url) {
    html += '<div class="detail-section">';
    html += `<div class="detail-title">${ICONS.link} URL</div>`;
    html += `<div class="detail-url">${escapeAttr(record.url)}</div>`;
    html += '</div>';
  }

  // 编辑模式下的保存按钮
  if (editable) {
    html += `<button id="saveRecordBtn" class="btn btn-primary" style="margin-top:12px">${ICONS.save} Save Changes</button>`;
  }

  // 底部切换按钮
  if (!editable) {
    html += `<button id="switchToEdit" class="btn btn-primary" style="margin-top:12px;background:#e65100">${ICONS.pencil} Edit This Record</button>`;
  }

  container.innerHTML = html;

  // 绑定返回按钮
  document.getElementById('backToList').addEventListener('click', () => {
    renderHistoryList(container);
  });

  // 绑定切换到编辑模式
  const switchBtn = document.getElementById('switchToEdit');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      renderRecordDetail(record, container, true);
    });
  }

  // 绑定保存按钮
  const saveBtn = document.getElementById('saveRecordBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const updatedRecord = { ...record };

      // 收集表单名
      const formNameInput = document.getElementById('edit-formName');
      if (formNameInput) {
        updatedRecord.formName = formNameInput.value.trim();
      }

      // 收集字段值
      document.querySelectorAll('.detail-field-value').forEach(input => {
        const idx = parseInt(input.dataset.fieldIndex, 10);
        if (updatedRecord.fields && updatedRecord.fields[idx]) {
          updatedRecord.fields[idx].value = input.value.trim();
        }
      });

      try {
        const result = await chrome.runtime.sendMessage({
          type: MSG.UPDATE_RECORD,
          data: { id: record.id, record: updatedRecord },
        });
        if (result.success) {
          // 更新本地缓存
          const cacheIdx = currentRecords.findIndex(r => r.id === record.id);
          if (cacheIdx >= 0) currentRecords[cacheIdx] = result.data;
showPopupToast('Record saved', '#667eea');
          // 重新渲染为查看模式
          renderRecordDetail(result.data, container, false);
        } else {
          showPopupToast('Save failed: ' + (result.error || 'Unknown error'), '#f44336');
        }
      } catch (e) {
        showPopupToast('Save failed: ' + e.message, '#f44336');
      }
    });
  }
}

// ========== Toast ==========

function showPopupToast(msg, color) {
  const existing = document.querySelector('.popup-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'popup-toast';
  toast.style.background = color;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// ========== QuickMode 自动保存 ==========

document.getElementById('quickMode').addEventListener('change', async (e) => {
  const configResult = await chrome.runtime.sendMessage({ type: MSG.GET_CONFIG });
  if (!configResult.success) return;
  const config = { ...configResult.data, quickMode: e.target.checked };
  const result = await chrome.runtime.sendMessage({ type: MSG.SAVE_CONFIG, data: config });
  if (result.success) {
showPopupToast(e.target.checked ? 'Quick Mode enabled' : 'Quick Mode disabled', '#667eea');
  }
});

// ========== 初始化 ==========
function initIcons() {
  // Header icon
  const headerIcon = document.getElementById('header-icon');
  if (headerIcon) headerIcon.innerHTML = ICONS.bot;
  // Tab icons
  const tabIcons = { settings: ICONS.settings, profile: ICONS.user, history: ICONS.clipboardList, about: ICONS.info };
  for (const [tab, icon] of Object.entries(tabIcons)) {
    const el = document.getElementById(`tab-icon-${tab}`);
    if (el) el.innerHTML = icon;
  }
  // Button icons
  const btnSave = document.getElementById('btn-icon-save');
  if (btnSave) btnSave.innerHTML = ICONS.save;
  const btnTrash = document.getElementById('btn-icon-trash');
  if (btnTrash) btnTrash.innerHTML = ICONS.trash;
  // About icons
  const aboutLogo = document.getElementById('about-logo');
  if (aboutLogo) {
const bigBot = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`;
    aboutLogo.innerHTML = bigBot;
  }
  const aboutFeatures = document.getElementById('about-icon-features');
  if (aboutFeatures) aboutFeatures.innerHTML = ICONS.sparkles;
  const aboutTech = document.getElementById('about-icon-tech');
  if (aboutTech) aboutTech.innerHTML = ICONS.package;
  const aboutLinks = document.getElementById('about-icon-links');
  if (aboutLinks) aboutLinks.innerHTML = ICONS.link;
}

initIcons();
loadConfig();
