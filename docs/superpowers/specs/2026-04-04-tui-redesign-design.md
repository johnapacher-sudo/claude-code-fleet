# Fleet Master TUI 重设计

> 2026-04-04

## 一、设计目标

重写 `src/tui.js`，从当前的手搓 ANSI 全屏清屏方案升级为 Clean Minimal 风格的终端仪表盘。核心改进：

- 信息密度提升：每个 worker 卡片展示模型信息、对话轮次、动作详情
- 消除闪烁：局部刷新替代全屏清屏
- 动效反馈：进行中动作有 spinner 动画，新事件有视觉提示
- 键盘交互：j/k 滚动、Enter 展开、数字键聚焦

## 二、整体布局

```
┌─ header ────────────────────────────────────────────┐
│ ⬡ Fleet Master                  ● 2  ○ 1  3 sessions│
├──────────────────────────────────────────────────────┤
│                                                      │
│  ● my-project  opus-prod  claude-opus-4-6      [3m]  │
│  ┃ "测试通过了，现在重构一下错误处理逻辑"              │
│  ┃ ✓ Edit src/error-handler.js           8s ago      │
│  ┃ ✓ Read src/validator.js               3s ago      │
│  ┃ ⠋ Bash npm run test:coverage       running…      │
│  ┃                                                    │
│  ┃ "我来帮你修复这个 bug，先看看相关代码"              │
│  ┃   ✓ Read → Edit → Bash                   2m ago   │
│  ─────────────────────────────────────────────────── │
│  ● api-server  sonnet-fast  claude-sonnet-4-6   [12m] │
│  ┃ ...                                                │
│  ─────────────────────────────────────────────────── │
│  ○ test-runner  haiku  claude-haiku-4-5        [idle] │
│  ┃ ...                                                │
│                                                      │
├─ footer ────────────────────────────────────────────┤
│ [j/k] scroll  [enter] expand  [1-9] filter  [q] quit │
└──────────────────────────────────────────────────────┘
```

### Worker 排序

按活跃度排序：running → slow → idle。同状态内按 `lastEventAt` 降序（最近活跃的排前面）。

## 三、卡片分层结构

每个 worker 卡片分 3 层：

### 第 1 层：卡片头部

一行，左右布局：

```
● my-project  opus-prod  claude-opus-4-6              3m
```

| 元素 | 样式 | 数据来源 |
|------|------|----------|
| 状态图标 `●`/`○` | 绿色(活跃) / 灰色(idle) / 黄色⚠(slow) | 由 `lastEventAt` 计算 |
| 项目名 | 白色加粗 | `path.basename(cwd)` |
| 模型别名 | 紫色 | `fleet_model_name`（如有） |
| 模型名 | 暗灰 | `modelName` |
| 运行时长 | 暗灰 | `now - firstEventAt` |

### 第 2 层：当前轮（展开）

左侧有彩色竖线边框（`border-left: 2px`）。最多展示 3 个动作。

```
┃ "AI 回复摘要文本，一行截断"                    ← AI 总结（斜体灰色）
┃ ✓ Edit src/error-handler.js           8s ago   ← 已完成（绿色 ✓）
┃ ✓ Read src/validator.js               3s ago   ← 已完成
┃ ⠋ Bash npm run test:coverage       running…   ← 进行中（黄色 spinner）
```

**AI 摘要来源：** 紧接该轮 PostToolUse 之后的 Notification 消息文本。截断为一行（超出终端宽度部分省略）。

**动作状态判定：**
- 已完成：`PostToolUse` 已收到，且下一个事件（Notification 或下一个 PostToolUse）也已到达
- 进行中：最近的 `PostToolUse`，之后尚未收到新事件

**进行中动效：**
- Braille spinner 字符循环（`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`），120ms 一帧
- 黄色高亮（`#fbbf24`）
- 右侧显示 `running…` 而非时间戳
- 整个动作行有呼吸效果（opacity 在 0.4~1.0 之间脉动）

### 第 3 层：历史轮（折叠）

左侧灰色竖线。动作折叠为单行。

```
┃ "我来帮你修复这个 bug"                   ← AI 总结（暗灰斜体）
┃   ✓ Read → Edit → Bash         2m ago   ← 折叠的动作链
```

**折叠规则：**
- 动作列表用 `→` 连接，只显示工具名
- 如果超过 3 个动作，显示前 3 个 + `+N more`
- 最多展示 1 轮历史（即只展示上一轮）

## 四、对话轮次数据模型

### 轮次切分规则

以 **Notification 事件** 作为轮次边界：

```
Notification "我来帮你修改"     ← 第 1 轮开始
  PostToolUse: Read
  PostToolUse: Edit
  PostToolUse: Bash
Notification "测试通过了"       ← 第 1 轮结束 / 第 2 轮开始
  PostToolUse: Edit
  PostToolUse: Bash            ← 当前进行中的动作
(尚未收到下一个 Notification)   ← 第 2 轮仍在进行中
```

### 数据结构

在 `master.js` 中维护 worker 状态时，增加 `turns` 字段：

```javascript
// WorkerState.turns 结构
{
  turns: [
    {
      summary: "测试通过了，现在重构一下错误处理逻辑",  // Notification 文本
      summaryTime: 1712200060000,
      actions: [
        { tool: "Edit", target: "src/error-handler.js", time: 1712200061000, status: "done" },
        { tool: "Read", target: "src/validator.js", time: 1712200062000, status: "done" },
        { tool: "Bash", target: "npm run test:coverage", time: 1712200063000, status: "running" },
      ]
    },
    {
      summary: "我来帮你修复这个 bug",
      summaryTime: 1712200030000,
      actions: [
        { tool: "Read", target: "src/core.js", time: 1712200031000, status: "done" },
        { tool: "Edit", target: "src/core.js", time: 1712200032000, status: "done" },
        { tool: "Bash", target: "npm test", time: 1712200033000, status: "done" },
      ]
    }
  ]
}
```

**轮次更新逻辑：**

1. 收到 `Notification` → 如果当前有未关闭的轮次，将其关闭（所有 action 标记为 done），用 Notification 文本作为上一轮的 summary，然后开始新轮次
2. 收到 `PostToolUse` → 添加到当前轮次的 actions 数组
3. 收到新 PostToolUse 时，将上一个 action 的 status 从 `running` 改为 `done`
4. 最多保留最近 2 轮

## 五、技术方案：Ink (React for CLI)

### 为什么选 Ink

- **自动 diff 更新**：React reconciliation 机制只更新变化的行，无需手动管理局部刷新
- **flexbox 布局**：自适应终端宽度，不用手动计算列宽
- **组件化**：WorkerCard、TurnBlock、ActionLine 等独立组件，可读可维护
- **生态**：`ink-spinner` 提供 spinner 动画，`ink-text-input` 处理键盘输入

### 依赖

```json
{
  "dependencies": {
    "ink": "^5.0.0",
    "ink-spinner": "^5.0.0",
    "react": "^18.0.0"
  }
}
```

Ink 5 + React 18，体积约 2MB。

### 组件树

```
<App>                          ← 顶层，接收 master.workers 数据
  <Header />                   ← ⬡ Fleet Master + 状态计数
  <WorkerList>                 ← 排序后的 worker 列表
    <WorkerCard>               ← 每个 worker 卡片
      <CardHeader />           ← 状态图标 + 项目名 + 模型 + 时长
      <CurrentTurn>            ← 当前轮（展开）
        <AiSummary />          ← AI 摘要（一行）
        <ActionLine />         ← 单个动作（✓ 或 spinner）
        <ActionLine />
        <ActionLine />         ← 最多 3 个
      </CurrentTurn>
      <HistoryTurn>            ← 历史轮（折叠）
        <AiSummary />
        <CollapsedActions />   ← ✓ Read → Edit → Bash
      </HistoryTurn>
    </WorkerCard>
  </WorkerList>
  <Footer />                   ← 键盘提示
</App>
```

### 数据流

```
master.js (event handler)
  └→ 更新 workers Map（含 turns 数据）
     └→ 调用 render callback
        └→ Ink rerender（React diff，只更新变化的部分）
```

Master 维护 workers 状态，TUI 作为纯展示层通过 callback 触发重绘。Ink 的 reconciliation 保证只更新变化的行。

### Spinner 动画

使用 `ink-spinner` 组件，内置 Braille 动画帧，无需手动管理定时器：

```jsx
import Spinner from 'ink-spinner';

<ActionLine>
  <Text color="#fbbf24"><Spinner type="dots" /></Text>
  <Text color="#fbbf24"> {tool}</Text>
  <Text color="#8b949e"> {target}</Text>
</ActionLine>
```

### 事件合并

保持 master.js 中的 100ms debounce（`scheduleRender`），批量合并事件后触发一次 Ink rerender。

## 六、键盘交互

| 按键 | 功能 |
|------|------|
| `j` / `↓` | 选择下一个 worker |
| `k` / `↑` | 选择上一个 worker |
| `Enter` | 展开/折叠当前 worker 的历史轮 |
| `1`-`9` | 快速聚焦第 N 个 worker |
| `Tab` | 切换排序方式（按活跃时间 / 按名称） |
| `q` / `Ctrl+C` | 退出 |

选中状态：当前选中的 worker 卡片头部有一个 `❯` 前缀标记，或者头部行背景色微亮。

## 七、颜色方案

暗色主题，Ink 的 `<Text color="...">` 直接支持 hex 颜色值：

| 元素 | 颜色 | 色值 |
|------|------|------|
| 头部标题 `⬡ Fleet Master` | 紫色 | `#a78bfa` |
| 状态 running | 绿色 | `#4ade80` |
| 状态 idle | 暗灰 | `#525252` |
| 状态 slow | 黄色 | `#fbbf24` |
| 项目名 | 白色 | `#e0e0e0` |
| 模型别名 | 紫色 | `#a78bfa` |
| 模型名 | 暗灰 | `#525252` |
| AI 摘要 | 灰色斜体 | `#8b949e` |
| 工具名 | 浅灰 | `#d4d4d4` |
| 目标文件 | 灰色 | `#8b949e` |
| 已完成标记 `✓` | 绿色 | `#4ade80` |
| 进行中 spinner | 黄色 | `#fbbf24` |
| 当前轮竖线 | 绿色 | `#4ade80` |
| 历史轮竖线 | 暗灰 | `#525252` |
| 分隔线 | 深灰 | `#1e1e1e` |
| footer 文字 | 深灰 | `#333333` |

## 八、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/tui.js` | 重写 | Ink 组件化 TUI，替代手搓 ANSI |
| `src/components/` | 新增 | Ink 组件目录（WorkerCard, TurnBlock, ActionLine 等） |
| `src/master.js` | 修改 | WorkerState 增加 turns 数据结构，轮次切分逻辑 |
| `src/hook-client.js` | 无变更 | 现有事件已足够 |
| `package.json` | 修改 | 添加 ink, ink-spinner, react 依赖 |

引入 Ink + React 作为依赖（约 2MB），不再使用手搓 ANSI 方案。
