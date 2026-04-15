# 桌面通知功能设计

> 独立于 Master/Observer，在 hook-client 层直接发送系统桌面通知

## 需求概述

Claude Code 进程执行完毕后，弹出系统桌面通知（macOS Notification Center / Linux notify-send / Windows Toast）。点击通知可聚焦到对应的终端窗口。

**触发场景**：
- 任务执行完成（Stop 事件）
- 任务异常结束（Stop 事件中检测到错误内容）
- Claude 主动通知（Notification 事件）
- 执行超时（超过阈值未收到新事件）

**非目标**：不依赖 Master 或 Observer 运行，通知功能完全自包含在 hook-client 中。

## 架构

### 数据流

```
Claude Code 事件
  → stdin 传入 hook-client.js
    → 现有逻辑：转发到 Unix socket（不变）
    → 新增逻辑：检查事件类型 → notifier.sendNotification()
      → macOS: terminal-notifier / osascript
      → Linux: notify-send
      → Windows: PowerShell toast
      → 点击回调：执行 terminal-focus AppleScript
```

### 新增文件

```
src/
  notifier.js              ← 通知发送模块（新增）
  hook-client.js           ← 集成通知调用（修改）
```

`notifier.js` 与 `hook-client.js` 一起被复制到 `~/.config/claude-code-fleet/hooks/` 目录。

### 通知触发规则

| 事件 | 触发 | 内容 |
|------|------|------|
| `SessionStart` | 否，更新活跃时间戳 | — |
| `PostToolUse` | 否，更新活跃时间戳 + 检查超时 | — |
| `Stop` | 是 | 标题区分正常/异常，body 为 AI 最后消息摘要 |
| `Notification` | 是 | body 为 Claude 通知消息 |
| **超时** | 每次调用时检查 | 距上次活跃 > 阈值且未通知过 |

## notifier.js 模块设计

### 公开接口

```js
// 发送桌面通知
sendNotification({ title, body, sessionId, platform })

// 检查并触发超时通知
checkTimeout(sessionId, config)

// 更新活跃时间戳文件
updateActivity(sessionId)

// 清除超时通知标记（Stop 事件时调用）
clearTimeoutFlag(sessionId)

// 检测消息是否为异常错误
detectError(message) → boolean
```

### 通知发送策略（按平台）

| 平台 | 方案 | 点击支持 |
|------|------|----------|
| macOS | 优先 `terminal-notifier`（支持点击），回退 `osascript`（不支持点击） | 有/无 |
| Linux | `notify-send` | 通过 `-a` 指定 action，有限支持 |
| Windows | PowerShell `[System.Windows.Forms.NotifyIcon]` | 有限支持 |

#### macOS 实现

1. 检测 `terminal-notifier` 是否安装（`which terminal-notifier`）
2. 已安装：用 `terminal-notifier -title "Fleet" -message "..." -execute "..."` 发送，`-execute` 指向聚焦脚本
3. 未安装：用 `osascript -e 'display notification ...'` 发送（无点击回调，通知本身正常工作）
4. 首次使用时如果未安装 `terminal-notifier`，通知中提示用户安装以获得点击跳转体验

#### 点击聚焦脚本

生成 `~/.config/claude-code-fleet/hooks/focus-session.js`（独立 CommonJS 脚本）：
- 由 `terminal-notifier -execute` 调用：`node focus-session.js <session_id>`
- 读取 `~/.config/claude-code-fleet/sessions/<id>.json` 获取 terminal 信息（termProgram, itermSessionId, ppid, cwd）
- 内联 AppleScript 聚焦逻辑（复用 `terminal-focus.mjs` 中的策略，但用 CJS `execSync` 实现而非 ESM import）
- 不依赖 notifier.js，完全独立可执行

### 超时检测逻辑

因为 hook-client 是每次事件独立调用的短生命周期脚本，用文件存储活跃时间戳：

1. 读取 `~/.config/claude-code-fleet/sessions/<id>.last-activity`
2. 文件不存在 → 跳过（新会话）
3. 计算 `elapsed = now - lastActivity`
4. `elapsed > timeoutThreshold`（默认 5min）：
   - 检查 `<id>.timeout-notified` 标记文件
   - 已标记 → 跳过（防止重复）
   - 未标记 → 发送超时通知 + 创建标记文件
5. 收到 Stop 事件 → 清除 `.timeout-notified` 标记

### 错误检测

通过分析 Stop 事件的 `last_assistant_message` 内容间接判断：

- 包含 "error"、"failed"、"exception" 等关键词 → 标记为异常结束
- 通知标题区分："任务完成" vs "任务异常结束"
- `detectError()` 为纯函数，可配置关键词列表

## hook-client.js 集成改动

### 执行流程

```
hook-client.js main()
  │
  ├─ 1. 读取 stdin、构建 payload（不变）
  │
  ├─ 2. 现有逻辑：session 文件读写（不变）
  │
  ├─ 3. socket 转发（不变）
  │
  └─ 4. 新增：通知分支（与 socket 并行，非阻塞）
       │
       ├─ 读取 notify.json 配置
       │
       ├─ 所有事件 → updateActivity()
       │
       ├─ PostToolUse → checkTimeout()
       │
       ├─ Stop → clearTimeoutFlag()
       │         + detectError() → sendNotification()
       │
       └─ Notification → sendNotification()
```

### 代码结构变化

```js
// hook-client.js 新增部分
const { sendNotification, checkTimeout, updateActivity, clearTimeoutFlag, detectError } = require('./notifier');

async function main() {
  // ... 现有 stdin 读取和 payload 构建 ...

  // 现有 socket 转发（不变）
  forwardToSocket(payload);

  // 新增：通知分支
  try {
    const config = loadNotifyConfig();
    if (!config.enabled) return;

    updateActivity(sessionId);

    if (event === 'PostToolUse') {
      checkTimeout(sessionId, config);
    }

    if (event === 'Stop') {
      clearTimeoutFlag(sessionId);
      clearStopNotified(sessionId);
      if (!isStopNotified(sessionId)) {
        const isAbnormal = detectError(payload.last_assistant_message);
        sendNotification({
          title: isAbnormal ? '⚠ 任务异常结束' : '✅ 任务完成',
          body: payload.last_assistant_message,
          sessionId,
          platform: process.platform,
        });
        markStopNotified(sessionId);
      }
    }

    if (event === 'Notification') {
      sendNotification({
        title: 'Claude 通知',
        body: payload.message,
        sessionId,
        platform: process.platform,
      });
    }
  } catch {
    // 通知失败静默忽略，不影响主流程
  }
}
```

### 防重复通知

- Stop 通知：用 `.stop-notified` 标记文件，同一 session 只通知一次
- 超时通知：用 `.timeout-notified` 标记文件，超时状态只通知一次
- Stop 事件清除两种标记文件

## 配置管理

### 配置文件

路径：`~/.config/claude-code-fleet/notify.json`

```json
{
  "enabled": true,
  "timeoutMinutes": 5,
  "events": {
    "stop": true,
    "error": true,
    "timeout": true,
    "notification": true
  }
}
```

配置文件不存在时默认全部启用。

### CLI 命令

在 `src/index.js` 中新增 `fleet notify` 子命令：

```
fleet notify              # 查看当前通知配置
fleet notify --on         # 开启通知
fleet notify --off        # 关闭通知
fleet notify --timeout 10 # 设置超时阈值为 10 分钟
```

### ensureHooks 改动

`master.js` 中的 `ensureHooks()` 需要同时复制 `notifier.js` 到 hooks 目录：

```js
// 新增复制 notifier.js
const notifierSrc = path.join(__dirname, 'notifier.js');
const notifierDest = path.join(HOOKS_DIR, 'notifier.js');
fs.copyFileSync(notifierSrc, notifierDest);
```

## 边界情况

| 场景 | 处理方式 |
|------|----------|
| `notify.json` 不存在 | 默认全部启用，不阻塞正常使用 |
| `notifier.js` 加载失败 | try-catch 包裹 require，降级为无通知模式 |
| `terminal-notifier` 未安装 (macOS) | 回退到 `osascript`，console 提示安装方式 |
| 同一 session 多次 Stop | `.stop-notified` 标记防止重复 |
| 非 macOS 点击聚焦 | 通知正常发送，点击功能不可用 |
| Session 文件不存在时点击 | 静默忽略，不 crash |
| 超大消息 | 通知 body 截断到 200 字符 |
| notifier.js 不在 hooks 目录 | hook-client 的 require 失败 → 降级无通知 |
| focus-session.js 不存在时点击通知 | terminal-notifier 静默失败，不影响系统 |

## 测试策略

| 测试类型 | 范围 | 方式 |
|----------|------|------|
| 单元测试 | `sendNotification` 参数构造 | mock `child_process.execFileSync` |
| 单元测试 | `checkTimeout` 超时/未超时/已通知 | mock `fs` 操作 + 时间戳文件 |
| 单元测试 | `detectError` 关键词匹配 | 纯函数测试 |
| 单元测试 | `loadNotifyConfig` 存在/不存在/格式错误 | 临时目录 |
| 单元测试 | `updateActivity` / `clearTimeoutFlag` | 验证文件写入 |
| 集成测试 | hook-client 端到端通知触发 | 模拟 stdin → spy sendNotification |
| 手动测试 | macOS 实际桌面通知 + 点击聚焦 | 真实环境 |

不测试的内容：第三方工具行为（terminal-notifier/osascript）、非 macOS 平台聚焦。
