# Master-Worker 架构设计

> 日期：2026-04-03
> 状态：已批准
> 范围：为 claude-code-fleet 添加主进程（含 TUI）、任务队列和双向通信功能

## 概述

添加一个主守护进程（`fleetd`），用于管理多个 Claude Code 工作实例。Worker 自主运行，通过 Claude Code hooks 上报进度。主进程在终端 TUI 中实时显示状态，并支持动态任务分配。

核心交互模型：**全自主运行 + 异常上报**。Worker 从队列中执行任务，无需人工干预。仅错误或需要人类决策的事件才会上报到主进程 TUI。

## 架构

```
fleet start   →  Master（fleetd）
                  ├── TUI 面板（ANSI 转义序列，零依赖）
                  ├── Unix Socket 服务端（~/.config/claude-code-fleet/fleet.sock）
                  ├── 任务队列管理器（每个 worker 独立队列）
                  └── Worker 管理器
                        ├── fork() Worker 1
                        │     └── spawn claude -p "task" --dangerously-skip-permissions
                        ├── fork() Worker 2
                        │     └── spawn claude -p "task" --dangerously-skip-permissions
                        └── ...
```

## 组件

### 1. 主进程（`src/master.js`）

单个 Node.js 进程，运行以下功能：

- **Unix Socket 服务端**：监听 `~/.config/claude-code-fleet/fleet.sock`，处理来自 hook-client.js 实例的连接
- **任务队列管理器**：跟踪每个 worker 的任务队列，处理出队和动态追加
- **Worker 管理器**：通过 `fork()` 启动 worker 进程，监控健康状态，处理重启
- **状态持久化**：将 worker 状态写入 `fleet-state.json`，用于崩溃恢复

### 2. Worker 封装器（`src/worker.js`）

从主进程 fork 出来的 Node.js 进程：

- 通过 IPC（`process.on('message')`）接收配置和初始任务
- 使用 `-p <task>` + `--dangerously-skip-permissions` 参数启动 `claude`
- 捕获 claude 的 stdout/stderr 并转发给主进程用于 TUI 显示
- 向主进程报告 claude 进程退出状态
- 主进程在启动 worker 前，向 worker 的工作目录注入 `.claude/settings.local.json`

### 3. Hook 通信桥（`src/hook-client.js`）

共享脚本位于 `~/.config/claude-code-fleet/hooks/hook-client.js`：

- 由 Claude Code hooks 调用（PostToolUse、Stop、Notification）
- 从 stdin 读取 JSON（Claude Code 提供事件上下文）
- 通过 Unix Socket 将事件发送给主进程
- 等待主进程响应，将结果写入 stdout 供 Claude Code 消费
- 通过环境变量识别 worker 身份：`FLEET_WORKER_NAME`、`FLEET_SOCK_PATH`

### 4. TUI 面板（`src/tui.js`）

使用 ANSI 转义序列渲染的终端 UI，零依赖：

- **状态面板**：worker 名称、状态（RUNNING/IDLE/ERROR）、任务进度、当前任务、已用时间
- **日志面板**：所有 worker 的实时滚动事件，按类型颜色编码
- **输入面板**：向选中的 worker 发送任务、回复通知
- **快捷键**：上/下选择 worker、Enter 发送、a 添加任务、f 过滤日志、q 退出

### 5. Unix Socket 层（`src/socket.js`）

基于 Unix Socket 的双向 JSON 协议：

- 主进程监听，hook-client.js 每次事件时连接
- 请求/响应模型：hook-client 发送事件，主进程同步响应
- 响应决定 hook 行为（继续、停止、注入指令）

## Hook 协议

### Settings 注入

主进程在每个 worker 的工作目录中生成 `.claude/settings.local.json`：

```json
{
  "hooks": {
    "PostToolUse": [{
      "hooks": [{
        "type": "command",
        "command": "FLEET_WORKER_NAME=<name> FLEET_SOCK_PATH=<path> node ~/.config/claude-code-fleet/hooks/hook-client.js PostToolUse",
        "timeout": 5
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "FLEET_WORKER_NAME=<name> FLEET_SOCK_PATH=<path> node ~/.config/claude-code-fleet/hooks/hook-client.js Stop",
        "timeout": 30
      }]
    }],
    "Notification": [{
      "hooks": [{
        "type": "command",
        "command": "FLEET_WORKER_NAME=<name> FLEET_SOCK_PATH=<path> node ~/.config/claude-code-fleet/hooks/hook-client.js Notification",
        "timeout": 5
      }]
    }]
  }
}
```

### 消息格式

**PostToolUse**（Worker → Master）：

```json
{ "event": "PostToolUse", "worker": "opus-worker", "tool_name": "Edit", "tool_input": { "file_path": "...", "old_string": "...", "new_string": "..." }, "tool_response": "..." }
```

主进程响应：`{ "ok": true }`

**Notification**（Worker → Master）：

```json
{ "event": "Notification", "worker": "opus-worker", "message": "API rate limit", "notification_type": "permission_prompt" }
```

主进程响应：`{ "ok": true }`

**Stop**（Worker → Master）：

```json
{ "event": "Stop", "worker": "opus-worker", "last_assistant_message": "...", "session_id": "abc-123" }
```

主进程响应 —— 继续下一个任务：

```json
{ "action": "continue", "reason": "Implement error handling for the API layer" }
```

主进程响应 —— 没有更多任务：

```json
{ "action": "stop" }
```

### Stop Hook 响应行为

当 hook-client.js 收到主进程的 `action: "continue"` 时：

```json
{ "decision": "block", "reason": "Implement error handling for the API layer" }
```

Claude Code 将此作为新指令接收，在同一会话中继续工作。

当 hook-client.js 收到主进程的 `action: "stop"` 时：以退出码 0 退出，Claude Code 正常停止。

## 任务队列

### 配置

在 `fleet.config.json` 中为每个实例定义任务：

```json
{
  "instances": [
    {
      "name": "opus-worker",
      "apiKey": "sk-ant-xxx",
      "model": "claude-opus-4-6",
      "cwd": "./workspace/opus",
      "tasks": [
        "Analyze project architecture",
        "Refactor src/core.js into modules",
        "Write unit tests for core modules"
      ]
    }
  ]
}
```

`tasks` 为可选字段。如果省略，worker 以 IDLE 状态启动，等待主进程分配任务。

### 队列状态机

```
PENDING → RUNNING → CHECKING → RUNNING（下一个任务）或 IDLE
                                     ↑                |
                                     └── 主进程推送 ──┘
```

每个 worker 的状态：

| 状态 | 说明 |
|------|------|
| PENDING | 已排队，尚未启动 |
| RUNNING | 正在通过 claude 执行任务 |
| CHECKING | Stop hook 已触发，正在向主进程查询下一个任务 |
| IDLE | 没有剩余任务，等待主进程分配 |
| ERROR | Claude 进程异常退出 |

### 主进程侧数据结构

```js
{
  workerName: {
    status: 'running' | 'idle' | 'error',
    currentTask: 'Refactor src/core.js',
    taskIndex: 2,
    totalTasks: 5,
    pendingTasks: ['Write unit tests'],
    completedTasks: ['Analyze architecture', 'Refactor modules'],
    sessionId: 'abc-123',
    lastActivity: Date.now(),
    pid: 12345
  }
}
```

### 动态任务追加

可在运行时通过以下方式添加任务：
- TUI 输入：选中 worker，输入新任务
- CLI 命令：`fleet task add <worker> "task description"`

新任务追加到 `pendingTasks`。下一次 Stop hook 调用时会获取这些任务。

## TUI 布局

```
┌─ Claude Code Fleet ────────────────────────────────────── HH:MM:SS ─┐
│                                                                      │
│  ● opus-worker    RUNNING   2/5  Refactoring core.js     00:03:12   │
│  ● sonnet-worker  RUNNING   1/3  Implementing API         00:01:45   │
│  ○ haiku-worker   IDLE      3/3  (no pending tasks)       00:08:22   │
│  ! custom-worker  ERROR     0/2  API rate limit            00:00:03   │
│                                                                      │
├─ Worker Logs ────────────────────────────────────────────────────────┤
│ [opus] PostToolUse: Edit src/core.js (line 45-78)                   │
│ [opus] PostToolUse: Bash "npm test"                                  │
│ [sonnet] Notification: Need database config confirmation             │
│ [haiku] Stop: All tasks completed, now idle                          │
│ [custom] Error: API rate limit exceeded                              │
├─ Input ──────────────────────────────────────────────────────────────┤
│ > _                                                                  │
│                                                                      │
│ Keys: ↑↓ select | Enter send | a add task | f filter | q quit       │
└──────────────────────────────────────────────────────────────────────┘
```

### 快捷键

| 按键 | 操作 |
|------|------|
| 上/下 | 切换选中的 worker |
| Enter | 向选中的 worker 发送输入文本 |
| `a` | 向选中 worker 的队列添加任务 |
| `f` | 按选中 worker 过滤日志 |
| `q` | 退出主进程 TUI（worker 继续运行） |

## Worker 生命周期

### 启动序列

1. 主进程读取 `fleet.config.json`
2. 对每个实例：
   a. 确保 `cwd` 目录存在
   b. 写入 `cwd/.claude/settings.local.json`（hook 注入）
   c. 复制 `hook-client.js` 到 `~/.config/claude-code-fleet/hooks/`
   d. 通过 IPC 将实例配置传递给 `fork(worker.js)`
3. Worker 启动 `claude -p "<first task>" --dangerously-skip-permissions --model <model>`
4. Worker 捕获 claude 的 stdout/stderr，转发给主进程

### 错误处理

| 场景 | 处理方式 |
|------|----------|
| Claude 进程崩溃 | Worker 通知主进程，TUI 显示 `! ERROR`，用户可从 TUI 重试或跳过 |
| 主进程崩溃 | Worker 和 Claude 继续运行；hooks 静默失败（超时 → Claude 继续运行） |
| Hook 超时 | Claude Code 根据 settings 中的 timeout 值强制超时；超时后 Claude 正常继续 |
| 没有可用任务 | Stop hook 以退出码 0 返回，Claude 停止，worker 进入 IDLE 状态 |
| Socket 连接失败 | hook-client.js 捕获错误，以退出码 0 退出（非阻塞），Claude 继续运行 |

### 主进程恢复

启动时，主进程检查 `fleet-state.json` 中正在运行的 worker PID。如果发现存活进程，则重新连接到现有 worker 而非重新创建。TUI 从持久化数据中恢复状态。

## 命令变更

### 新增命令

| 命令 | 说明 |
|------|------|
| `fleet start` | 启动主进程守护程序及所有 worker |
| `fleet attach` | 将 TUI 连接到运行中的主进程 |
| `fleet task add <worker> <task>` | 向 worker 队列追加任务 |

### 保留命令（向后兼容）

| 命令 | 行为 |
|------|------|
| `fleet up` | 不通过主进程启动 worker（现有行为） |
| `fleet down` | 停止后台 worker（现有行为） |
| `fleet ls` | 列出运行中的实例（现有行为） |
| `fleet run` | 单个交互式会话（现有行为） |
| `fleet model *` | 模型配置管理（现有行为） |

## 文件结构

### 源代码文件

```
src/
  index.js              # 入口文件 + 命令路由（已有）
  master.js             # 主进程：TUI + Socket 服务端 + 任务管理器
  worker.js             # Worker 封装器：管理 claude 子进程
  hook-client.js        # Hook 桥接：claude → Unix Socket → 主进程
  tui.js                # TUI 渲染（使用 ANSI 转义序列）
  socket.js             # Unix Socket 服务端/客户端
```

### 运行时文件

```
~/.config/claude-code-fleet/
  fleet.sock              # Unix Socket（主进程运行时存在）
  fleet-state.json        # Worker PID + 状态持久化（已有）
  models.json             # 模型配置（已有）
  hooks/
    hook-client.js        # 共享 hook 通信脚本
```

### 配置变更

`fleet.config.example.json` 中每个实例新增可选 `tasks` 字段。

## 约束

- 零外部依赖（仅使用 Node.js 内置模块）
- 需要 Node.js >= 18
- Claude Code CLI 必须全局安装
- Unix Socket 需要 Unix-like 操作系统（macOS、Linux）
- 主进程模式不支持 Windows（Unix Socket 限制；基础 fleet 模式仍可使用）
