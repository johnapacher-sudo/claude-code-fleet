# Fleet Master Observer Mode - 实现设计计划

> 最后更新: 2026-04-04

## 一、设计背景

经过多轮讨论，Fleet Master 的定位从"多 worker 编排管理器"简化为**纯观察者面板**。

### 核心设计决策

| 决策点 | 结论 |
|--------|------|
| Master 职责 | 纯观察者，不 spawn worker、不管理任务、不处理权限 |
| Hook 类型 | 全部 async，不阻塞任何 Claude Code 进程 |
| Worker 状态 | running / slow / stale / idle，dead 自动移除 |
| 任务队列 | 不需要，Master 不推送任务 |
| 权限处理 | 不处理，Worker 自行解决（`--dangerously-skip-permissions` 或终端自行处理） |
| Hook 安装 | 一次性安装常驻，Master 未运行时 hook-client 静默退出 |
| 死亡检测 | 收到 Stop 事件即移除，或长时间无事件标记 stale |
| 上下文窗口 | 模型配置中的选配字段，`fleet model add/edit` 时设置 |

### 与 Vibe Island 的定位区别

- **Vibe Island**：单进程权限审批 GUI（macOS 原生刘海区域）
- **Claude Code Fleet**：多进程观察面板（终端 TUI）

## 二、架构总览

```
终端1: fleet run --model opus    终端2: claude           终端3: fleet start
  │                                 │                       │
  └── claude 进程                   └── claude 进程          └── Master 观察面板
        │                                │                        │
        └── async hooks ────────────────┘                        │
                    │                                              │
              Unix Socket                                          │
                    │                                              │
              Master 进程 ─────────────────────────────────────────┘
              ┌──────────────┐
              │ Socket Server│  接收所有 hook 事件
              │ State Manager│  维护 worker 状态
              │ Stale Detect │  定时检测超时
              │ TUI Renderer │  渲染面板
              └──────────────┘
```

**核心原则：**

- Master 纯观察者，不 spawn、不阻塞、不推送
- 所有 hook 全部 async，worker 完全无感
- 有事件就显示，Stop 了就消失

## 三、事件流与数据模型

### Hook 事件协议

hook-client.js 从 stdin 读取 Claude Code 的 hook 输出，追加元数据后发送到 master：

```javascript
{
  event: "PostToolUse",          // PostToolUse | Stop | Notification
  session_id: "abc123",          // Claude Code 会话 ID
  timestamp: 1712200000000,      // 当前时间
  cwd: "/path/to/project",       // process.cwd()

  // PostToolUse 专有
  tool_name: "Edit",
  tool_input: { file_path: "src/core.js" },
  tool_output: "...",

  // Stop 专有（字段需要实际验证）
  stop_reason: "end_turn",

  // Notification 专有
  message: "..."
}
```

### Master 内部状态

```javascript
// Map<session_id, WorkerState>
const workers = new Map();

// WorkerState 结构
{
  sessionId: "abc123",
  displayName: "project-name",   // cwd 的最后一级目录名
  cwd: "/path/to/project",
  status: "running",             // running | slow | stale | idle
  firstEventAt: 1712200000000,   // 首次收到事件的时间
  lastEventAt: 1712200000000,    // 最后一次事件时间
  lastEvent: "Edit src/core.js", // 最近一次操作的简述
  logs: [],                      // 环形缓冲区，最多保留 200 条
  tokens: {
    input: 0,
    output: 0,
    total: 0
  }
}
```

### 状态流转

```
收到第一条事件         → running
10 分钟无事件          → slow（黄色 ⚠）
30 分钟无事件          → stale（红色 ⚠⚠）
收到 Stop 事件         → 从 workers Map 中移除，TUI 不再显示
再次收到事件（同 session）→ 重新添加（如 resume 场景）
```

## 四、Hook 安装机制

### 安装策略

Hook 一次性安装，常驻不删除。Master 没运行时 hook-client 静默退出。

- `fleet start` 首次运行时检查并安装 hooks（幂等操作，已安装则跳过）
- Master 退出时**不删除** hooks
- 用户可通过 `fleet hooks install` / `fleet hooks remove` 手动管理

### hook-client.js 设计

```javascript
const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf-8'));

const payload = {
  ...input,
  cwd: process.cwd(),
  timestamp: Date.now()
};

const sockPath = path.join(os.homedir(), '.config', 'claude-code-fleet', 'fleet.sock');

const client = net.connect(sockPath, () => {
  client.write(JSON.stringify(payload) + '\n');
  client.end();
});

// master 没运行 → connect 失败 → error 事件 → 直接退出
client.on('error', () => process.exit(0));

// 超时保护，1 秒内必须连上
setTimeout(() => process.exit(0), 1000);
```

Master 未运行时：connect 失败 → error 事件 → `process.exit(0)` → 耗时 < 1ms。Claude Code 完全无感。

### 注入的 Hook 配置

写入 `~/.claude/settings.json` 的 hooks 配置：

```json
{
  "hooks": {
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

```javascript
function injectHooks(settings) {
  const hookPath = path.join(GLOBAL_CONFIG_DIR, 'hooks', 'hook-client.js');

  for (const event of ['PostToolUse', 'Stop', 'Notification']) {
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks[event]) settings.hooks[event] = [];

    // 检查是否已存在 fleet 的 hook（幂等）
    const exists = settings.hooks[event].some(
      h => h.command && h.command.includes('claude-code-fleet')
    );
    if (!exists) {
      settings.hooks[event].push({ command: `node ${hookPath}`, async: true });
    }
  }
  return settings;
}

function removeHooks(settings) {
  for (const event of Object.keys(settings.hooks || {})) {
    settings.hooks[event] = settings.hooks[event].filter(
      h => !h.command || !h.command.includes('claude-code-fleet')
    );
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks || {}).length === 0) delete settings.hooks;
  return settings;
}
```

## 五、各组件详细设计

### 1. src/hook-client.js（简化）

**职责：** 从 stdin 读取 hook 输入 → 追加 cwd + timestamp → 发送到 Unix socket → 立即退出

**关键特性：**

- 纯 async，fire-and-forget
- Master 未运行时静默退出（< 1ms）
- 不处理任何响应，不阻塞 Claude Code

### 2. src/socket.js（简化）

**职责：** 仅接收事件，按行分割 JSON，调用 handler

```javascript
class SocketServer {
  constructor(handler) {
    this.handler = handler;  // (payload) => void
    this.server = null;
  }

  start(sockPath) {
    // 确保目录存在
    // 如果 socket 文件已存在，先删除
    // 创建 Unix socket server
    // 收到数据 → 按行分割 → JSON.parse → handler(payload)
  }

  stop() {
    this.server.close();
    // 删除 socket 文件
  }
}
```

### 3. src/master.js（重写）

**职责：** Socket 接收 + 状态管理 + Stale 检测 + Hook 注入

```javascript
class Master {
  constructor() {
    this.workers = new Map();
    this.socketServer = null;
    this.tui = null;
    this.staleTimer = null;
  }

  start() {
    // 1. 确保 hooks 已安装（幂等）
    this.ensureHooks();

    // 2. 启动 socket server
    this.socketServer = new SocketServer(this.handleEvent.bind(this));
    this.socketServer.start(SOCK_PATH);

    // 3. 启动 stale 检测定时器（每 30 秒）
    this.staleTimer = setInterval(this.checkStale.bind(this), 30_000);

    // 4. 启动 TUI
    this.tui = new TUI(this);
    this.tui.start();

    // 5. 注册退出清理
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  stop() {
    // 注意：不删除 hooks
    clearInterval(this.staleTimer);
    this.socketServer.stop();
    this.tui.stop();
  }

  handleEvent(payload) {
    const sid = payload.session_id;
    if (!sid) return;

    // 首次见到这个 session → 创建 worker
    if (!this.workers.has(sid)) {
      this.workers.set(sid, {
        sessionId: sid,
        displayName: path.basename(payload.cwd || 'unknown'),
        cwd: payload.cwd || '',
        status: 'running',
        firstEventAt: Date.now(),
        lastEventAt: Date.now(),
        lastEvent: '',
        logs: [],
        tokens: { input: 0, output: 0, total: 0 }
      });
    }

    const worker = this.workers.get(sid);
    worker.lastEventAt = Date.now();

    // Stop 事件 → 移除 worker
    if (payload.event === 'Stop') {
      this.workers.delete(sid);
      this.tui.render();
      return;
    }

    // PostToolUse → 记录操作日志
    if (payload.event === 'PostToolUse') {
      worker.lastEvent = this.summarizeToolUse(payload);
      worker.logs.push({ ...payload, time: Date.now() });
      if (worker.logs.length > 200) worker.logs.shift();
    }

    // Notification → 记录消息
    if (payload.event === 'Notification') {
      worker.lastEvent = payload.message || 'notification';
      worker.logs.push({ ...payload, time: Date.now() });
    }

    // 更新 token 信息
    this.updateTokens(worker, payload);

    // 从 stale/slow 恢复到 running
    if (worker.status !== 'idle') worker.status = 'running';

    this.tui.render();
  }

  checkStale() {
    const now = Date.now();
    for (const [sid, w] of this.workers) {
      const elapsed = now - w.lastEventAt;
      if (elapsed > 30 * 60 * 1000) w.status = 'stale';
      else if (elapsed > 10 * 60 * 1000) w.status = 'slow';
    }
    this.tui.render();
  }

  summarizeToolUse(payload) {
    const tool = payload.tool_name;
    const input = payload.tool_input || {};
    switch (tool) {
      case 'Edit':  return `Edit ${path.basename(input.file_path || '')}`;
      case 'Write': return `Write ${path.basename(input.file_path || '')}`;
      case 'Read':  return `Read ${path.basename(input.file_path || '')}`;
      case 'Bash':  return `Bash: ${(input.command || '').slice(0, 50)}`;
      case 'Grep':  return `Grep "${(input.pattern || '').slice(0, 30)}"`;
      case 'Glob':  return `Glob ${input.pattern || ''}`;
      default:      return tool;
    }
  }

  updateTokens(worker, payload) {
    // 从 payload 中提取 token 数据（具体字段需要验证）
    // 如果有 token 数据，累加到 worker.tokens
  }
}
```

### 4. src/tui.js（重写布局）

**布局设计：**

```
┌─ Fleet Master ───────────────────────────────────────────┐
│  3 workers │ ● 2 running │ ○ 1 idle                      │
├───────────────────────────────────────────────────────────┤
│                                                           │
│ ● my-project     [running 3m]                             │
│   ~/workspace/my-project                                  │
│   Tokens: 45k / 200k  ███████░░░░░  22.5%                 │
│   ├ Edit src/core.js                         3s ago       │
│   ├ Read package.json                        15s ago      │
│   └ Bash: npm test                           30s ago      │
│                                                           │
│ ● other-app      [running 12m ⚠]                          │
│   ~/workspace/other-app                                   │
│   Tokens: 120k / 200k  ████████████░  60%                 │
│   ├ Grep "TODO" in src/                      2m ago       │
│   └ Bash: npm run build                      3m ago       │
│                                                           │
│ ○ test-runner    [idle 5m]                                │
│   ~/workspace/test-runner                                 │
│   Tokens: 22k                                             │
│   └ Write README.md                          5m ago       │
│                                                           │
│ [q] Quit  [↑↓] Scroll                                    │
└───────────────────────────────────────────────────────────┘
```

**每个 Worker 展示内容：**

| 行 | 内容 | 说明 |
|----|------|------|
| 第 1 行 | 状态图标 + 名称 + 状态标签 + 运行时长 | `● my-project [running 3m]` |
| 第 2 行 | 工作目录 | `~/workspace/my-project`（`~` 替换 home） |
| 第 3 行 | Token 使用 / 上下文窗口 + 进度条 | 无数据则省略此行 |
| 第 4-N 行 | 最近 3 条操作日志（简要） | 工具名 + 目标 + 时间 |

**操作日志简要规则：**

```javascript
function summarizeToolUse(event) {
  const tool = event.tool_name;
  const input = event.tool_input || {};
  switch (tool) {
    case 'Edit':  return `Edit ${path.basename(input.file_path || '')}`;
    case 'Write': return `Write ${path.basename(input.file_path || '')}`;
    case 'Read':  return `Read ${path.basename(input.file_path || '')}`;
    case 'Bash':  return `Bash: ${(input.command || '').slice(0, 50)}`;
    case 'Grep':  return `Grep "${(input.pattern || '').slice(0, 30)}"`;
    case 'Glob':  return `Glob ${input.pattern || ''}`;
    default:      return tool;
  }
}
```

**Worker 排序：** running > slow > stale > idle

### 5. src/index.js（修改）

#### `fleet start` 简化

```javascript
// 之前: 读取 config → spawn workers → 启动 master
// 现在: 直接启动 master，不需要 config

function cmdStart() {
  checkDeps();
  const master = new Master();
  master.start();
}
```

不需要读取 `fleet.config.json`，不需要 `--only` 参数。

#### `fleet model add` 增加可选 contextWindow

```
  Name: opus-prod
  Model ID (e.g. claude-opus-4-6):
  API Key:
  API Base URL (leave empty for default):
  Context Window (tokens, leave empty to skip):       ← 新增，选配
```

```javascript
async function cmdModelAdd() {
  // ... 现有逻辑 ...
  const contextWindow = await ask('  Context Window (tokens, leave empty to skip): ');
  if (contextWindow) entry.contextWindow = parseInt(contextWindow, 10);
  // ...
}
```

#### `fleet model edit` 同理

```javascript
const contextWindow = await ask(`  Context Window [${entry.contextWindow || ''}]: `);
if (contextWindow) entry.contextWindow = parseInt(contextWindow, 10);
```

#### `fleet model list` 增加 contextWindow 显示

```
  opus-prod
    model:     claude-opus-4-6
    apiKey:    sk-ant-api03-x...
    context:   200k tokens
```

#### 新增 `fleet hooks` 命令

```
fleet hooks install   — 手动安装 hooks 到 ~/.claude/settings.json
fleet hooks remove    — 手动移除 hooks
fleet hooks status    — 查看当前 hooks 安装状态
```

#### 移除的命令

- `fleet task add` — 无任务队列，不再需要

### 6. src/worker.js（删除）

Master 不再 spawn worker，此文件无用。

## 六、Token 与上下文信息

### 数据来源

需要验证 Stop hook 和 PostToolUse hook 的实际输入数据字段。

**验证方法：** 编写测试脚本，将 hook 输入写入临时文件，查看实际字段：

```bash
# 测试脚本
echo '{"hooks":{"PostToolUse":[{"command":"cat > /tmp/hook-data.json"}]}}' \
  > .claude/settings.local.json
claude -p "say hello"
cat /tmp/hook-data.json
```

可能包含的字段：`input_tokens`、`output_tokens`、`cost_usd`、`total_input_tokens`、`total_output_tokens`

### 上下文窗口来源

从模型配置读取（选配字段）：

```json
// ~/.config/claude-code-fleet/models.json
{
  "models": [
    {
      "name": "opus-prod",
      "model": "claude-opus-4-6",
      "apiKey": "sk-ant-xxx",
      "contextWindow": 200000
    },
    {
      "name": "haiku-fast",
      "model": "claude-haiku-4-5-20251001",
      "apiKey": "sk-ant-yyy",
      "contextWindow": 128000
    },
    {
      "name": "custom",
      "model": "claude-sonnet-4-6",
      "apiKey": "sk-ant-zzz"
      // contextWindow 未设置
    }
  ]
}
```

### 显示逻辑

```
有 contextWindow 且有 token 数据:  Tokens: 57k / 200k  ██████░░  28.5%
只有 token 数据:                    Tokens: 57k
都没有:                             (省略此行)
```

### Context Window 匹配策略

hook-client.js 在事件中可能无法携带模型信息。匹配策略：

1. 优先：hook 事件中包含 model 字段 → 直接匹配
2. 回退：无法确定模型 → 只显示 raw tokens，不显示比例

## 七、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/hook-client.js` | 重写 | 简化为 async fire-and-forget，静默退出 |
| `src/socket.js` | 重写 | 简化为仅接收，按行解析 JSON |
| `src/master.js` | 重写 | 事件接收 + 状态管理 + stale 检测 + hook 安装 |
| `src/tui.js` | 重写 | 新布局：header + worker 详情 + 操作日志 |
| `src/index.js` | 修改 | 简化 start；model add/edit 加 contextWindow；新增 hooks 命令；移除 task 命令 |
| `src/worker.js` | 删除 | 不再需要 |
| `README.md` | 更新 | 新架构说明 |
| `README.zh.md` | 更新 | 新架构说明 |
| `fleet.config.example.json` | 简化 | 移除 tasks 字段 |

## 八、实现步骤（执行顺序）

### 步骤 1：验证 Hook 数据字段

编写测试脚本，确认 PostToolUse / Stop / Notification hook 的实际输入字段，特别是 token 相关数据。

### 步骤 2：重写 src/hook-client.js

- 从 stdin 读取 JSON
- 追加 cwd + timestamp
- 发送到 Unix socket（fire-and-forget）
- Master 未运行时静默退出

### 步骤 3：重写 src/socket.js

- 仅接收，不发送响应
- 按行分割 JSON
- 调用 handler 回调

### 步骤 4：重写 src/master.js

- Socket 接收事件
- Worker 状态管理（Map + 状态流转）
- Stale 检测定时器
- Hook 注入（幂等，启动时检查）
- TUI 集成

### 步骤 5：重写 src/tui.js

- Header：worker 总数统计
- Worker 列表：状态 + 目录 + token + 最近 3 条日志
- Footer：操作提示

### 步骤 6：修改 src/index.js

- `fleet start` 简化（不读 config，直接启动 master）
- `fleet model add/edit` 增加 contextWindow（选配）
- `fleet model list` 显示 contextWindow
- 新增 `fleet hooks install/remove/status`
- 移除 `fleet task add`

### 步骤 7：删除 src/worker.js

不再需要 worker spawn 逻辑。

### 步骤 8：更新文档

- README.md
- README.zh.md
- fleet.config.example.json

## 九、风险与注意事项

1. **Hook 数据字段不确定**：步骤 1 必须先执行，验证后再确定 token 展示方案
2. **全局 Hook 注入安全性**：必须合并不覆盖，退出时清理干净，不能破坏用户已有的 hook 配置
3. **Socket 文件残留**：启动前检查并清理旧的 socket 文件
4. **Hook-client 静默失败**：master 未运行时 hook-client 必须立即退出（< 1ms），不影响 Claude Code
5. **Context window 匹配**：模型配置中是选配的，未配置时不显示比例，只显示原始 token 数
6. **Hook 冲突**：如果用户已有 PostToolUse / Stop / Notification hooks，fleet 的 hooks 应追加而非替换
