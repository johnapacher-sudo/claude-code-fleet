# Ink Interactive Selector 重设计

> 2026-04-05

## 一、设计目标

将 `src/index.js` 中的手搓 ANSI `selectFromList()` 函数替换为 Ink 组件化选择器，用于 `fleet run`、`fleet model edit`、`fleet model delete` 三个命令的交互选择场景。

核心改进：
- 卡片式布局：每项显示模型名称、模型 ID、API key 缩略、endpoint
- 视觉分层：选中项有紫色竖线 + 箭头 + 背景高亮
- 场景区分：delete 场景用红色竖线警示危险操作
- 确认反馈：选择后只留一行绿色确认文字

## 二、组件设计

### 新文件：`src/components/selector.mjs`

通用 Ink 选择器组件，接收配置参数渲染卡片列表。

**Props：**

```javascript
{
  title: 'Select a model to run',  // 标题文本
  items: [                          // 选项列表
    {
      label: 'opus-prod',           // 主标签（项目名）
      detail: 'claude-opus-4-6',    // 右侧详情（模型 ID）
      meta: 'key: sk-ant-x... · endpoint: default',  // 第二行元信息
      value: 'opus-prod',           // 选中后的返回值
    }
  ],
  dangerMode: false,                // true 时选中项竖线变红色
  onSelect: (item) => {},           // 选择回调
  onCancel: () => {},               // 取消回调
}
```

**布局：**

```
⬡ Select a model to run
↑↓ navigate · enter select · q cancel

┃❯ opus-prod                    claude-opus-4-6
┃  key: sk-ant-api03-x... · endpoint: default

┃  sonnet-fast                  claude-sonnet-4-6
┃  key: sk-ant-api03-y... · endpoint: default

┃  haiku                        claude-haiku-4-5
┃  key: sk-ant-api03-z... · endpoint: https://proxy.example.com
```

**选中态样式：**
- 左侧紫色竖线（`#a78bfa`，border-left 3px）（dangerMode 时为红色 `#f85149`）
- 前缀箭头 `❯`（紫色/红色）
- 项目名白色加粗
- 背景色微亮（`#161b22` vs `#0d1117`）

**非选中态样式：**
- 竖线透明
- 项目名灰色
- 背景暗色

**键盘：**
- `↑↓` / `j/k` — 上下移动
- `Enter` — 确认选择
- `q` / `Ctrl+C` — 取消退出

### 确认后输出

选择器消失（Ink `clear()`），只输出一行：

```
❯ opus-prod  claude-opus-4-6
```

选中标记和项目名变为绿色 `#4ade80`，详情灰色。

## 三、集成方式

### 修改 `src/index.js` — 替换 `selectFromList`

`selectFromList` 函数（190-258 行）重写为调用 Ink 选择器组件：

```javascript
async function selectFromList(items, label, dangerMode = false) {
  const { renderSelector } = await import('./components/selector.mjs');
  return renderSelector({ title: label, items, dangerMode });
}
```

### 各命令的数据适配

**`fleet run`（cmdRun）：**

```javascript
const items = data.models.map(m => ({
  label: m.name,
  detail: m.model || 'default',
  meta: `key: ${m.apiKey ? m.apiKey.slice(0, 12) + '...' : 'not set'} · endpoint: ${m.apiBaseUrl || 'default'}`,
  value: m.name,
}));
const selected = await selectFromList(items, 'Select a model to run');
```

**`fleet model edit`（cmdModelEdit）：**

```javascript
const items = data.models.map(m => ({
  label: m.name,
  detail: m.model || 'default',
  meta: `key: ${m.apiKey ? m.apiKey.slice(0, 12) + '...' : 'not set'} · endpoint: ${m.apiBaseUrl || 'default'}`,
  value: m.name,
}));
const selected = await selectFromList(items, 'Select a model to edit');
```

**`fleet model delete`（cmdModelDelete）：**

```javascript
const items = data.models.map(m => ({
  label: m.name,
  detail: m.model || 'default',
  meta: `key: ${m.apiKey ? m.apiKey.slice(0, 12) + '...' : 'not set'} · endpoint: ${m.apiBaseUrl || 'default'}`,
  value: m.name,
}));
const selected = await selectFromList(items, 'Select a model to delete', true); // dangerMode
```

## 四、颜色方案

与 TUI dashboard 一致，复用 `colors.mjs`：

| 元素 | 颜色 | 色值 |
|------|------|------|
| 标题 `⬡` | 紫色 | `#a78bfa` |
| 选中竖线（正常） | 紫色 | `#a78bfa` |
| 选中竖线（危险） | 红色 | `#f85149` |
| 选中箭头 `❯` | 紫色/红色 | 同竖线 |
| 项目名（选中） | 白色 | `#e0e0e0` |
| 项目名（未选中） | 灰色 | `#8b949e` |
| 详情（模型 ID） | 暗灰 | `#525252` |
| 元信息 | 灰色 | `#8b949e` |
| 确认后标记 | 绿色 | `#4ade80` |
| 操作提示 | 暗灰 | `#525252` |

## 五、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/selector.mjs` | 新增 | Ink 选择器组件 |
| `src/index.js` | 修改 | 重写 `selectFromList`，适配各命令数据 |
