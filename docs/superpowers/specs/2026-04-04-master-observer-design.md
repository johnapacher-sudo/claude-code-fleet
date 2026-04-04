# Fleet Master Observer Mode - 改进设计

> 日期: 2026-04-04
> 基于: master-observer-plan.md，经边界问题分析后的改进版

## 一、核心定位

Master 是**纯观察者面板**，不 spawn worker、不管理任务、不处理权限。通过 async hooks 被动接收所有 Claude Code 进程的事件，在 TUI 中展示。

## 二、改进点（相对原计划）

| 改进项 | 原计划 | 改进后 |
|--------|--------|--------|
| 模型信息 | 无法获取 | 新增 SessionStart hook 获取 model name + fleet run 环境变量获取 displayName |
| Worker 区分 | displayName（目录名） | 始终显示 session ID 后缀（前 4 位） |
| 进程状态 | running / slow / stale / idle | 只有 running（有事件即活跃） |
| 僵尸清理 | 30 min stale，不自动移除 | 3 小时无事件自动从 Map 移除 |
| Token 展示 | 显示 token + context 百分比 | MVP 不实现（hook 事件无 token 字段） |
| 事件负载 | 发送完整 hook 数据 | 过滤 tool_response，只发必要字段 |
| TUI 渲染 | 每事件立即渲染 | 100ms 防抖 |
| Hook 事件 | PostToolUse / Stop / Notification | 新增 SessionStart |

## 三、事件流

### Hook 事件类型

| Hook 事件 | 用途 | 发送的必要字段 |
|-----------|------|----------------|
| SessionStart | 获取 model name，创建 worker 记录 | event, session_id, cwd, model, timestamp |
| PostToolUse | 记录操作日志 | event, session_id, cwd, tool_name, tool_input, timestamp |
| Stop | 移除 worker 记录 | event, session_id, timestamp |
| Notification | 记录通知消息 | event, session_id, message, notification_type, timestamp |

### hook-client.js 过滤策略

```javascript
const payload = {
  event: input.hook_event_name,
  session_id: input.session_id,
  cwd: input.cwd,
  timestamp: Date.now()
};

// SessionStart 专有
if (input.hook_event_name === 'SessionStart') {
  payload.model = input.model;
}

// PostToolUse 专有 — 只发 tool_name 和 tool_input，不发 tool_response
if (input.hook_event_name === 'PostToolUse') {
  payload.tool_name = input.tool_name;
  payload.tool_input = input.tool_input;
}

// Notification 专有
if (input.hook_event_name === 'Notification') {
  payload.message = input.message;
  payload.notification_type = input.notification_type;
}

// fleet run 注入的环境变量（如果存在）
if (process.env.FLEET_DISPLAY_NAME) {
  payload.fleet_display_name = process.env.FLEET_DISPLAY_NAME;
}
```

## 四、数据模型

### WorkerState

```javascript
{
  sessionId: "abc123",
  displayName: "my-project",       // path.basename(cwd)
  sessionIdShort: "abc1",          // session_id 前 4 位
  cwd: "/path/to/project",
  modelName: "claude-opus-4-6",    // 来自 SessionStart，可能为空
  fleetDisplayName: "opus-prod",   // 来自 fleet run 环境变量，可能为空
  lastEventAt: 1712200000000,
  lastEvent: "Edit src/core.js",
  firstEventAt: 1712200000000,
  logs: []                         // 环形缓冲区，最多 200 条
}
```

### 状态流转

```
SessionStart 或首次 PostToolUse → 添加到 workers Map
收到任何事件                    → 更新 lastEventAt
Stop 事件                      → 从 workers Map 移除
3 小时无事件                   → 定时器检测并移除
再次收到事件（同 session_id）  → 重新添加
```

## 五、Hook 安装

### 注入的 Hook 配置

写入 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "SessionStart": [{
      "command": "node ~/.config/claude-code-fleet/hooks/hook-client.js",
      "async": true
    }],
    "PostToolUse": [{
      "command": "node ~/.config/claude-code-fleet/hooks/hook-client.js",
      "async": true
    }],
    "Stop": [{
      "command": "node ~/.config/claude-code-fleet/hooks/hook-client.js",
      "async": true
    }],
    "Notification": [{
      "command": "node ~/.config/claude-code-fleet/hooks/hook-client.js",
      "async": true
    }]
  }
}
```

### 合并策略

- 幂等操作：检查已有 hook 中是否包含 `claude-code-fleet` 路径
- 追加而非替换，不破坏用户已有 hooks
- 使用原子写入（写入临时文件 → rename），防止并发写入损坏 settings.json
- Master 退出时不删除 hooks

### settings.json 写入保护

```javascript
function atomicWriteJSON(filePath, data) {
  const tmpPath = filePath + '.fleet-tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}
```

## 六、TUI 布局

```
┌─ Fleet Master ──────────────────────────────────────────┐
│  3 workers │ 2 active                                    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ ● my-project abc1  ·  opus-prod (claude-opus-4-6)       │
│   ~/workspace/my-project              running 3m         │
│   ├ Edit src/core.js                         3s ago      │
│   ├ Read package.json                        15s ago     │
│   └ Bash: npm test                           30s ago     │
│                                                          │
│ ● other-app abc2  ·  claude-sonnet-4-6                   │
│   ~/workspace/other-app               running 12m        │
│   ├ Grep "TODO" in src/                      2m ago      │
│   └ Bash: npm run build                      3m ago      │
│                                                          │
│ [q] Quit  [↑↓] Scroll                                   │
└──────────────────────────────────────────────────────────┘
```

### 每个 Worker 展示内容

| 行 | 内容 | 说明 |
|----|------|------|
| 第 1 行 | 状态图标 + 项目名 + session ID 短码 + 模型信息 | `● my-project abc1 · opus-prod (claude-opus-4-6)` |
| 第 2 行 | 工作目录 + 运行时长 | `~/workspace/my-project  running 3m` |
| 第 3-N 行 | 最近 3 条操作日志 | 工具名 + 目标 + 相对时间 |

### 模型信息显示规则

| 场景 | 显示内容 |
|------|---------|
| fleet run，有 displayName 和 model | `opus-prod (claude-opus-4-6)` |
| 只有 model（手动 claude） | `claude-sonnet-4-6` |
| 都没有（SessionStart 未捕获） | 不显示模型行 |

### TUI 渲染防抖

```javascript
let renderTimer = null;
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    this.render();
  }, 100);
}
```

## 七、fleet run 环境变量注入

`fleet run --model opus` 启动 claude 时注入：

```bash
FLEET_DISPLAY_NAME=opus-prod
```

hook-client.js 检测到该环境变量后附加到事件 payload 中。

## 八、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/hook-client.js` | 重写 | 过滤字段 + SessionStart 处理 + env 读取 |
| `src/socket.js` | 重写 | 简化为仅接收，按行解析 JSON |
| `src/master.js` | 重写 | 事件接收 + 状态管理 + 3h 超时清理 + hook 安装（原子写入） |
| `src/tui.js` | 重写 | 新布局：header + worker 详情 + 日志 + 100ms 防抖 |
| `src/index.js` | 修改 | 简化 start；fleet run 注入 env var；新增 hooks 命令；移除 task 命令 |
| `src/worker.js` | 删除 | 不再需要 |
| `README.md` | 更新 | 新架构说明 |
| `README.zh.md` | 更新 | 新架构说明 |
| `fleet.config.example.json` | 简化 | 移除 tasks 字段 |

## 九、实现步骤

### 步骤 1：重写 src/hook-client.js
- 从 stdin 读取 JSON，过滤只保留必要字段
- 处理 SessionStart 事件提取 model
- 检测 FLEET_DISPLAY_NAME 环境变量
- Fire-and-forget 发送到 Unix socket
- Master 未运行时静默退出

### 步骤 2：重写 src/socket.js
- 仅接收模式，按行分割 JSON
- 调用 handler 回调
- 清理残留 socket 文件

### 步骤 3：重写 src/master.js
- Socket 接收事件
- Worker 状态管理（Map）
- 3 小时超时清理定时器（每 5 分钟检查一次）
- Hook 安装（原子写入 settings.json）
- TUI 集成

### 步骤 4：重写 src/tui.js
- Header：worker 总数 + 活跃数
- Worker 列表：项目名 + session ID + 模型 + 目录 + 最近 3 条日志
- 100ms 渲染防抖
- 键盘交互：q 退出，上下滚动

### 步骤 5：修改 src/index.js
- `fleet start` 简化（直接启动 master）
- `fleet run` 注入 FLEET_DISPLAY_NAME 环境变量
- 新增 `fleet hooks install/remove/status`
- 移除 `fleet task add`

### 步骤 6：删除 src/worker.js

### 步骤 7：更新文档和配置
- README.md / README.zh.md
- fleet.config.example.json
