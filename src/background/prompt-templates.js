
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
 * 智能融合填充 Prompt（增强版：含记忆上下文）
 * @param {Array} formSchema - 当前表单结构
 * @param {Object} userProfile - 用户画像
 * @param {Array} memories - 相关记忆条目
 * @param {string} userSupplement - 用户补充输入
 * @param {string} pageContext - 页面上下文
 */
export function buildFillPrompt(formSchema, userProfile, memories, userSupplement, pageContext) {
  return `你是一个超级智能的表单填充助手，拥有用户的完整记忆。

## 任务
根据用户的所有信息（画像 + 记忆 + 本次补充），为当前表单生成精准的填充数据。

## 页面上下文
URL/标题: ${pageContext || '未知'}

## 当前表单结构
${JSON.stringify(formSchema, null, 2)}

## 用户画像（结构化信息）
${JSON.stringify(userProfile, null, 2)}

## 用户记忆（自然语言记忆条目）
${memories.length > 0 ? memories.map(m => `- [${m.category}] ${m.content}${m.metadata ? ' ' + JSON.stringify(m.metadata) : ''}`).join('\n') : '暂无记忆'}

## 用户本次补充
"${userSupplement || '无'}"

## 核心规则
1. **优先级**：用户本次补充 > 相关记忆 > 用户画像
2. 用户补充可能是自然语言，需要你理解并提取结构化信息
3. **记忆智能关联**：如果记忆中提到"要去广州"，而表单有"目的地"字段，就应该填"广州"
4. 对于 select 类型字段，从可选项（options字段）中选择最匹配的值
5. **checkbox 填充规则**：
   - 单个 checkbox（valueType=boolean）：填 "true" 或 "false"
   - checkbox 组（valueType=multi-select）：填逗号分隔的选中项 value，如 "option1,option2"
6. **textarea 填充规则**：textarea 类型字段应该正常填写文本内容，可以包含多行文本，不要跳过
7. **智能生成模式**：${userSupplement?.includes?.('[AI_GENERATE]') ? '已开启。**必须为每一个字段都生成内容，绝对禁止返回 null**。对于没有历史数据的字段，请发挥想象力生成合理、逼真的模拟数据来填充（如合理的中文姓名、真实格式的手机号138xxxx、合理的地址、公司名、职位等）。你的目标是让表单 100% 填满。' : '未开启。但你仍然应该**尽最大努力填写每个字段**。只要能从上下文、记忆、补充信息、字段名称语义、常识中合理推断出内容，就必须填写。只有在字段含义完全无法理解的极端情况下才允许填 null。能猜就猜，用户可以自己修改。'}
8. 日期格式需要适配表单要求的格式
9. fillData 的 key 必须使用表单结构中的 name 字段值
10. **新记忆提取**：如果用户本次补充了新的信息（如偏好、计划），也要提取为新的记忆条目
11. **强制填写原则**：绝对不要轻易返回 null！即使没有完全匹配的历史数据，也要根据已有信息推断并填写。对于无法推断的字段，根据字段名和类型生成合理内容（例如：地址字段→生成一个合理的中国地址，邮编字段→生成一个合理的邮编，日期字段→生成一个合理的日期，姓名字段→生成一个中文姓名，等等）
12. **所有可见字段都要填写**：不要遗漏任何可填写的字段，包括 textarea、checkbox、radio、select、date 等。每个字段都必须有值。对于 select 类型，从选项中选一个最合理的；对于 textarea，写一段合理的文本内容；对于 date，选一个合理的日期
13. **宁可填错也不要留空**：用户修改一个错误值比从零输入要容易得多，所以请大胆填写。填写的内容要尽量合理、像真人填写的

## 输出格式（严格JSON，不要额外文字）
{
  "fillData": {
    "字段name": "填充值"
  },
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


