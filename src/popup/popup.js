
// ============================================
// Popup 页面交互逻辑
// ============================================

const MSG = {
  GET_CONFIG: 'GET_CONFIG',
  SAVE_CONFIG: 'SAVE_CONFIG',
  GET_PROFILE: 'GET_PROFILE',
  SAVE_PROFILE: 'SAVE_PROFILE',
  GET_RECORDS: 'GET_RECORDS',
  DELETE_RECORD: 'DELETE_RECORD',
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
    document.getElementById('apiEndpoint').value = endpoint;
    document.getElementById('modelName').value = model;
    // 高亮当前选中的预设
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    showPopupToast('已填入预设，请填写 API Key 后保存', '#667eea');
  });
});

// ========== 设置管理 ==========

async function loadConfig() {
  const result = await chrome.runtime.sendMessage({ type: MSG.GET_CONFIG });
  if (!result.success) return;

  const config = result.data;
  document.getElementById('apiEndpoint').value = config.apiEndpoint || '';
  document.getElementById('modelName').value = config.modelName || '';
  document.getElementById('apiKey').value = config.apiKey || '';
  document.getElementById('autoDetect').checked = config.autoDetect !== false;
  document.getElementById('enabledDomains').value = (config.enabledDomains || []).join(', ');

  // 自动高亮匹配的预设按钮
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.remove('active');
    if (config.apiEndpoint && config.apiEndpoint === btn.dataset.endpoint) {
      btn.classList.add('active');
    }
  });

  updateStatus(config);
}

function updateStatus(config) {
  const indicator = document.getElementById('status-indicator');
  if (config.apiKey) {
    indicator.className = 'status status-ok';
    indicator.textContent = `✅ 已配置 · ${config.modelName || 'unknown'} · 就绪`;
  } else {
    indicator.className = 'status status-warn';
    indicator.textContent = '⚠️ 未配置 API Key';
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
    enabledDomains: domains,
  };

  const result = await chrome.runtime.sendMessage({ type: MSG.SAVE_CONFIG, data: config });
  if (result.success) {
    showPopupToast('设置已保存', '#4CAF50');
    updateStatus(config);
  } else {
    showPopupToast('保存失败', '#f44336');
  }
});

document.getElementById('clearAllBtn').addEventListener('click', async () => {
  if (!confirm('确定要清空所有数据吗？包括用户信息和历史记录。')) return;
  await chrome.runtime.sendMessage({ type: MSG.CLEAR_ALL });
  showPopupToast('数据已清空', '#4CAF50');
  loadConfig();
});

// ========== 用户画像 ==========

// 当前画像数据的缓存
let currentProfile = null;

async function loadProfile() {
  const result = await chrome.runtime.sendMessage({ type: MSG.GET_PROFILE });
  const container = document.getElementById('profile-container');

  if (!result.success || !result.data) {
    container.innerHTML = '<div class="empty-state">暂无信息</div>';
    return;
  }

  currentProfile = result.data;
  renderProfile(currentProfile, container);
}

function renderProfile(profile, container) {
  let html = '';

  // 个人信息
  const personal = profile.personal || {};
  html += buildEditableSection('👤 个人信息', 'personal', personal, {
    name: '姓名', gender: '性别', birthday: '生日', idCard: '身份证',
  });

  // 联系方式
  const contact = profile.contact || {};
  html += buildEditableSection('📱 联系方式', 'contact', contact, {
    phone: '手机', email: '邮箱', wechat: '微信',
  });

  // 地址
  html += '<div class="profile-section">';
  html += '<div class="profile-title">📍 地址信息</div>';
  if (profile.addresses && profile.addresses.length > 0) {
    profile.addresses.forEach((addr, idx) => {
      html += `<div class="profile-edit-row">
        <label class="profile-edit-label">${addr.label || '地址' + (idx + 1)}:</label>
        <input class="profile-edit-input" data-category="address" data-index="${idx}" data-key="fullAddress" value="${escapeAttr(addr.fullAddress || '')}">
      </div>`;
    });
  } else {
    html += `<div class="profile-edit-row">
      <label class="profile-edit-label">地址:</label>
      <input class="profile-edit-input" data-category="address" data-index="0" data-key="fullAddress" value="" placeholder="暂无，可手动添加">
    </div>`;
  }
  html += '</div>';

  // 工作
  const work = profile.work || {};
  html += buildEditableSection('💼 工作信息', 'work', work, {
    company: '公司', department: '部门', position: '职位', workPhone: '工作电话',
  });

  // 教育
  const education = profile.education || {};
  html += buildEditableSection('🎓 教育信息', 'education', education, {
    school: '学校', major: '专业', degree: '学历', graduationYear: '毕业年份',
  });

  // 自定义字段
  const custom = profile.custom || {};
  if (Object.keys(custom).length > 0) {
    html += buildEditableSection('📎 其他信息', 'custom', custom, null);
  }

  // 最后更新时间
  if (profile.lastUpdated) {
    html += `<div style="text-align:center;font-size:11px;color:#999;margin-top:10px">最后更新: ${new Date(profile.lastUpdated).toLocaleString()}</div>`;
  }

  // 保存按钮
  html += '<button id="saveProfileBtn" class="btn btn-primary" style="margin-top:12px">💾 保存修改</button>';

  container.innerHTML = html;

  // 绑定保存事件
  document.getElementById('saveProfileBtn').addEventListener('click', saveProfileFromUI);
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
        <label class="profile-edit-label">${label}:</label>
        <input class="profile-edit-input" data-category="${category}" data-key="${key}" value="${escapeAttr(value)}" placeholder="未填写">
      </div>`;
    }
    // 也展示不在预定义中但已有数据的字段
    for (const [key, value] of Object.entries(data)) {
      if (!value || fieldDefs[key]) continue;
      html += `<div class="profile-edit-row">
        <label class="profile-edit-label">${key}:</label>
        <input class="profile-edit-input" data-category="${category}" data-key="${key}" value="${escapeAttr(value)}" placeholder="未填写">
      </div>`;
    }
  } else {
    // 自定义字段：直接展示所有已有数据
    for (const [key, value] of Object.entries(data)) {
      if (!value) continue;
      html += `<div class="profile-edit-row">
        <label class="profile-edit-label">${key}:</label>
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
        profile.addresses[index] = { label: '默认地址' };
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
    showPopupToast('个人信息已保存', '#4CAF50');
  } catch (e) {
    showPopupToast('保存失败: ' + e.message, '#f44336');
  }
}

// ========== 历史记录 ==========

async function loadHistory() {
  const result = await chrome.runtime.sendMessage({ type: MSG.GET_RECORDS });
  const container = document.getElementById('history-container');

  if (!result.success || !result.data || result.data.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无历史记录</div>';
    return;
  }

  let html = '';
  result.data.forEach(record => {
    const time = new Date(record.timestamp).toLocaleString();
    const fieldCount = record.fields ? record.fields.length : 0;
    html += `
      <div class="record-item">
        <span class="record-delete" data-id="${record.id}">删除</span>
        <div class="record-name">${record.formName || '未命名表单'}</div>
        <div class="record-meta">${record.domain} · ${fieldCount} 个字段 · ${time}</div>
      </div>
    `;
  });
  container.innerHTML = html;

  // 绑定删除事件
  container.querySelectorAll('.record-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm('确定删除此条记录？')) return;
      await chrome.runtime.sendMessage({ type: MSG.DELETE_RECORD, data: { id } });
      loadHistory();
    });
  });
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

// ========== 初始化 ==========
loadConfig();
