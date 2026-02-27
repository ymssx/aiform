
// ============================================
// Prompt 模板管理
// ============================================

/**
 * 表单数据结构化提取 + 记忆提取 Prompt
 * @param {Array} rawFields - 原始表单字段数据
 * @param {string} pageContext - 页面上下文信息（标题、URL等）
 */
export function buildExtractPrompt(rawFields, pageContext) {
  return `你是一个表单数据结构化专家，同时也是一个智能记忆助手。

## 任务
1. 将以下表单原始数据提取为结构化JSON
2. **从表单数据中提取一切未来可能有用的记忆信息**

## 页面上下文
${pageContext || '无'}

## 要求
1. 为每个字段推断语义分类（personal/contact/address/work/education/preference/other）
2. 为每个字段生成标准化的中文标签
3. 忽略CSRF token、hidden无意义字段、空值字段
4. 不要包含密码字段
5. 为整个表单生成一个简短名称
6. **记忆提取规则**：从表单内容中推断出有价值的记忆，包括但不限于：
   - 用户的出行计划（如目的地、日期、交通方式）
   - 用户的偏好习惯（如常用地址、偏好座位类型）
   - 用户的待办意图（如预约、购买计划）
   - 任何对未来表单填写有帮助的上下文信息

## 原始数据
${JSON.stringify(rawFields, null, 2)}

## 输出格式（严格JSON，不要额外文字）
{
  "formName": "表单名称",
  "fields": [
    {
      "category": "personal|contact|address|work|education|preference|other",
      "label": "中文字段名",
      "key": "字段标识符",
      "value": "字段值",
      "type": "text|email|phone|date|select|textarea|number"
    }
  ],
  "memories": [
    {
      "content": "记忆内容的自然语言描述，例如：用户计划2月28日去广州",
      "category": "intent|preference|fact|context",
      "expiresAt": null,
      "metadata": {}
    }
  ]
}

memories 中的 category 说明:
- intent: 意图/计划（如出行计划、购物计划），通常有时效性
- preference: 偏好习惯（如喜欢靠窗座位），通常长期有效
- fact: 事实信息（如身份证号、护照号），通常长期有效
- context: 临时上下文（如当前正在处理的事务），通常短期有效

expiresAt: 如果记忆有明确的时间相关性（如"后天去广州"），请根据当前时间推算一个合理的过期时间戳（毫秒），当前时间: ${Date.now()}。长期有效的记忆设为 null。`;
}

/**
 * 智能融合填充 Prompt（DOM 分析版）
 * AI 直接分析简化后的表单 DOM HTML，返回带 CSS 选择器的填充指令
 * @param {string} simplifiedDOM - 简化后的表单区域 HTML
 * @param {Object} userProfile - 用户画像
 * @param {Array} memories - 相关记忆条目
 * @param {string} userSupplement - 用户补充输入
 * @param {string} pageContext - 页面上下文
 */
export function buildFillPrompt(simplifiedDOM, userProfile, memories, userSupplement, pageContext) {
  return `你是一个超级智能的表单填充助手。你将直接分析表单的 DOM 结构来理解每个字段的含义。

## 任务
分析以下表单 DOM HTML，理解每个字段的用途，并根据用户信息生成精准的填充指令。

## 页面上下文
URL/标题: ${pageContext || '未知'}

## 表单 DOM HTML
\`\`\`html
${simplifiedDOM}
\`\`\`

## 用户画像（结构化信息）
${JSON.stringify(userProfile, null, 2)}

## 用户记忆（自然语言记忆条目）
${memories.length > 0 ? memories.map(m => `- [${m.category}] ${m.content}${m.metadata ? ' ' + JSON.stringify(m.metadata) : ''}`).join('\n') : '暂无记忆'}

## 用户本次补充
"${userSupplement || '无'}"

## DOM 分析规则
1. 仔细阅读 DOM 结构，识别每个可填写的表单字段（input, select, textarea, [role="textbox"], [role="combobox"], [contenteditable="true"] 等）
2. 通过字段的 label、placeholder、name、id、上下文文本来理解字段含义
3. label 可能是：
   - <label> 标签（通过 for 属性关联或包裹关系）
   - 字段前面/上面的 <div>/<span> 中的文本
   - 带有 class 名包含 "label" 的元素
   - 组件库的 label 容器（如 .t-form__label、.ant-form-item-label、.el-form-item__label、.wg-component-label 等）
4. 对于自定义下拉（非原生 <select>），通过 DOM 中的选项列表文本来识别可选值

## 填充指令格式
为每个需要填充的字段返回一个指令对象，包含：
- **selector**: 用于定位该元素的 CSS 选择器。优先使用 [name="xxx"]、#id、[data-id="xxx"] 等精确选择器；如果元素没有这些属性，使用足够精确的 CSS 选择器路径
- **label**: 该字段的中文标签名（从 DOM 上下文中提取）
- **value**: 要填充的值
- **type**: 字段类型（text/number/email/phone/date/select/textarea/checkbox/radio）
- **options**: 如果是 select 类型，列出可选项（从 DOM 中提取的选项文本数组）

## 核心填充规则
1. **优先级**：用户本次补充 > 相关记忆 > 用户画像
2. 用户补充可能是自然语言，需要你理解并提取结构化信息
3. **记忆智能关联**：如果记忆中提到"要去广州"，而表单有"目的地"字段，就应该填"广州"
4. 对于 select 类型字段，value 必须从可选项中选择匹配的值
5. **checkbox**：填 "true" 或 "false"
6. **radio**：填选项的 value 或文本
7. **智能生成模式**：${userSupplement?.includes?.('[AI_GENERATE]') ? '已开启。**必须为每一个字段都生成内容，绝对禁止返回 null**。对于没有历史数据的字段，请发挥想象力生成合理、逼真的模拟数据。' : '未开启。但你仍然应该**尽最大努力填写每个字段**。只有在字段含义完全无法理解的极端情况下才允许跳过。'}
8. **宁可填错也不要留空**：用户修改一个错误值比从零输入要容易得多
9. 日期格式需要适配表单要求的格式
10. 不要填充 submit/button/reset 类型的元素
11. 不要填充 disabled 或 readonly 的元素（除非你确定这是动态启用的）

## 输出格式（严格 JSON，不要额外文字）
{
  "fields": [
    {
      "selector": "CSS选择器",
      "label": "字段中文标签",
      "value": "填充值",
      "type": "字段类型",
      "options": ["选项1", "选项2"]
    }
  ],
  "updatedProfile": {
    "personal": { "name": "...", "gender": "...", "birthday": "..." },
    "contact": { "phone": "...", "email": "..." },
    "addresses": [{ "label": "默认地址", "fullAddress": "..." }],
    "work": { "company": "...", "position": "..." },
    "education": { "school": "...", "major": "..." },
    "preferences": {},
    "custom": {}
  },
  "newMemories": [
    {
      "content": "从用户补充中提取的新记忆",
      "category": "intent|preference|fact|context",
      "expiresAt": null,
      "metadata": {}
    }
  ],
  "changeLog": [
    "变更描述"
  ]
}

当前时间戳: ${Date.now()}`;
}

/**
 * 记忆提取 Prompt（从用户自然语言输入中提取记忆）
 * @param {string} userInput - 用户的自然语言输入
 * @param {string} pageContext - 页面上下文
 */
export function buildMemoryExtractPrompt(userInput, pageContext) {
  return `你是一个智能记忆管理助手。

## 任务
从用户的输入中提取所有有价值的记忆信息。

## 页面上下文
${pageContext || '无'}

## 用户输入
"${userInput}"

## 提取规则
1. 提取一切对未来可能有用的信息
2. 每条记忆应该是独立的、原子化的
3. 推断合理的分类和过期时间
4. 如果用户提到"后天"、"下周"等相对时间，根据当前时间推算绝对时间

当前时间戳: ${Date.now()}
当前日期: ${new Date().toLocaleDateString('zh-CN')}

## 输出格式（严格JSON）
{
  "memories": [
    {
      "content": "记忆内容描述",
      "category": "intent|preference|fact|context",
      "expiresAt": null,
      "metadata": { "关键字段": "结构化值" }
    }
  ]
}`;
}


