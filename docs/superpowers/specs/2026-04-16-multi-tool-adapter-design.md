# Multi-Tool Adapter Design

> Fleet 多工具支持设计：通过 Adapter 模式将 Claude Code 硬编码解耦，支持 Codex CLI 及未来其他 AI 编码工具。

## Background

当前 `claude-code-fleet` 的三种模式（Model Profile / Observer / Fleet）全部围绕 Claude Code CLI 设计，存在以下硬编码耦合：

- `checkDeps()` 检查 `which claude`
- `spawn('claude', ...)` 散布在 `cmdRun`、`cmdUp` 多处
- CLI 参数 `--dangerously-skip-permissions`、`--model`、`--settings` 是 Claude 特有的
- 环境变量 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL` 硬编码
- Hook 注入只写 `~/.claude/settings.json`
- Payload 解析假设 Claude 的 JSON 格式
- 通知标题硬编码为 `'Claude Code'`

OpenAI Codex CLI 已于 2026 年 3 月发布实验性 hook 系统，事件模型（`SessionStart`、`PostToolUse`、`Stop`）与 Claude Code 高度一致，使多工具适配具备可行性。

## Goals

1. **支持 Claude Code + Codex CLI**，三种模式（Model Profile / Observer / Fleet）全部适配
2. **Adapter 模式**实现工具解耦，新增工具只需添加一个 Adapter 文件
3. **100% 向后兼容**，现有用户零配置升级
4. **保持 `claude-code-fleet` 产品名不变**

## Non-Goals

- 不实现 Plugin 动态加载体系（当前仅两个工具，无需过度设计）
- 不改变项目名 / npm 包名
- 不支持 Codex 特有的 `PreToolUse`、`UserPromptSubmit` 事件（暂不需要）

---

## Design

### 1. Adapter 抽象层

#### 1.1 目录结构

```
src/
  adapters/
    base.js           # ToolAdapter 基类
    claude.js          # ClaudeAdapter
    codex.js           # CodexAdapter
    registry.js        # 注册表：tool name → adapter 实例
```

#### 1.2 ToolAdapter 基类

```javascript
class ToolAdapter {
  get name()            // 'claude' | 'codex' — 唯一标识
  get displayName()     // 'Claude Code' | 'Codex CLI' — TUI / 通知显示名
  get binary()          // 'claude' | 'codex' — CLI 二进制名

  isInstalled()
  // → boolean，通过 which ${binary} 检测

  buildArgs(entry)
  // → string[]，根据 model profile / fleet instance 构造 CLI 参数
  // Claude: ['--dangerously-skip-permissions', '--model', 'xxx', '--settings', '{...}']
  // Codex:  ['--model', 'xxx', '--config', 'key=value', ...]

  buildEnv(entry, baseEnv)
  // → object，构造环境变量
  // Claude: { ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, FLEET_MODEL_NAME }
  // Codex:  { OPENAI_API_KEY, FLEET_MODEL_NAME }

  installHooks()
  // 向工具的配置文件注入 fleet hook
  // Claude: 写 ~/.claude/settings.json（hooks 嵌入 JSON）
  // Codex:  写 ~/.codex/hooks.json + 确保 config.toml 中 codex_hooks = true

  removeHooks()
  // 清理注入的 hook

  normalizePayload(rawInput)
  // 将工具原生 hook stdin JSON 标准化为统一内部格式:
  // {
  //   event,          // 'SessionStart' | 'PostToolUse' | 'Stop' | 'Notification'
  //   session_id,
  //   cwd,
  //   tool_name,      // PostToolUse 时
  //   tool_input,     // PostToolUse 时
  //   model,          // SessionStart 时
  //   last_assistant_message,  // Stop 时
  //   message,        // Notification 时（Claude only）
  //   _tool,          // 'claude' | 'codex'
  // }

  summarizeToolUse(toolName, toolInput)
  // 工具调用的 TUI 摘要文本
  // Claude: Edit/Write/Bash/Search 等细粒度摘要
  // Codex:  Bash 摘要（当前 Codex PostToolUse 仅支持 Bash）

  get hookEvents()
  // → string[]，该工具支持的 hook 事件列表
  // Claude: ['SessionStart', 'PostToolUse', 'Stop', 'Notification']
  // Codex:  ['SessionStart', 'PostToolUse', 'Stop']
}
```

#### 1.3 Registry

```javascript
// registry.js
const adapters = new Map();

function register(adapter) { adapters.set(adapter.name, adapter); }
function get(name) { return adapters.get(name); }
function all() { return [...adapters.values()]; }
function installed() { return all().filter(a => a.isInstalled()); }

function detect(payload) {
  // 从 hook payload 的 _tool 字段识别来源
  // 兼容旧版无 _tool 字段的 payload → 默认 'claude'
  return payload._tool || 'claude';
}

// 启动时注册所有内置 adapter
register(new ClaudeAdapter());
register(new CodexAdapter());
```

---

### 2. 配置体系改动

#### 2.1 Model Profile（`~/.config/claude-code-fleet/models.json`）

新增可选 `tool` 字段，不填默认 `"claude"`：

```json
{
  "models": [
    {
      "name": "KIMI-部门",
      "tool": "claude",
      "model": "K2.6-code-preview",
      "apiKey": "sk-kimi-5dYz...",
      "apiBaseUrl": "https://api.kimi.com/coding/",
      "proxy": "it-hkproxy.cc.ctripcorp.com:2400..."
    },
    {
      "name": "GPT-5-Codex",
      "tool": "codex",
      "model": "gpt-5.4",
      "apiKey": "sk-xxx...",
      "apiBaseUrl": "https://api.openai.com/v1"
    }
  ]
}
```

#### 2.2 Fleet Config（`fleet.config.json`）

同样新增可选 `tool` 字段：

```json
{
  "instances": [
    {
      "name": "opus-worker",
      "tool": "claude",
      "apiKey": "sk-ant-api03-xxxxx",
      "model": "claude-opus-4-6"
    },
    {
      "name": "codex-worker",
      "tool": "codex",
      "apiKey": "sk-openai-yyyyy",
      "model": "gpt-5.4",
      "cwd": "./workspace/codex"
    }
  ]
}
```

#### 2.3 CLI 命令改动

**`fleet model add [tool]`**：

```bash
fleet model add claude    # 交互式添加，tool 自动设为 "claude"
fleet model add codex     # 交互式添加，tool 自动设为 "codex"
fleet model add           # 交互式添加，先选工具类型（默认高亮 Claude）
```

**`fleet run` 选择列表**增加工具标签：

```
⬢ Select a model to run

┃   KIMI-部门                                    [Claude] K2.6-code-preview
┃   key: sk-kimi-5dYz... · endpoint: https://api.kimi.com/...

┃   GPT-5-Codex                                  [Codex] gpt-5.4
┃   key: sk-xxx... · endpoint: https://api.openai.com/...
```

**`fleet run` 内部流程**：

```
entry.tool → registry.get(tool) → adapter.isInstalled()
→ adapter.buildArgs(entry) → adapter.buildEnv(entry, process.env)
→ spawn(adapter.binary, args, { env })
```

#### 2.4 checkDeps 改造

```javascript
// 旧：硬编码检查 claude
function checkDeps() {
  if (!run('which', ['claude'])) { ... }
}

// 新：按需检查对应工具
function checkToolDeps(toolName) {
  const adapter = registry.get(toolName || 'claude');
  if (!adapter) {
    console.error(`Unknown tool: ${toolName}`);
    process.exit(1);
  }
  if (!adapter.isInstalled()) {
    console.error(`Missing dependency: ${adapter.binary} (${adapter.displayName})`);
    process.exit(1);
  }
}
```

---

### 3. Observer / Hook 系统改造

#### 3.1 Hook 注入流程

`fleet start` 自动检测已安装工具并注入 hook：

```javascript
// master.js
async start() {
  const installedAdapters = registry.installed();
  for (const adapter of installedAdapters) {
    adapter.installHooks();
  }
  // ... 启动 TUI 和 SocketServer
}

stop() {
  for (const adapter of registry.installed()) {
    adapter.removeHooks();
  }
  // ...
}
```

#### 3.2 两个 Adapter 的 Hook 注入差异

| 维度 | ClaudeAdapter | CodexAdapter |
|---|---|---|
| 配置文件 | `~/.claude/settings.json`（hooks 嵌在 JSON 内） | `~/.codex/hooks.json`（独立文件） |
| 额外操作 | 无 | 确保 `~/.codex/config.toml` 中 `[features] codex_hooks = true` |
| 事件列表 | `SessionStart`, `PostToolUse`, `Stop`, `Notification` | `SessionStart`, `PostToolUse`, `Stop` |
| Hook 命令 | `node <hook-client.js> --tool claude` | `node <hook-client.js> --tool codex` |
| 标识检测 | `command.includes('claude-code-fleet')` | 同左 |

#### 3.3 hook-client.js 改造

hook-client.js 作为 Claude/Codex 的 hook 子进程被独立调用，需保持轻量。不引入完整 registry，而是直接 require 对应的 adapter 文件：

```javascript
async function main() {
  const toolName = parseToolArg() || 'claude';  // --tool claude|codex

  const input = await readStdin();

  // 直接加载对应 adapter（轻量依赖，不引入 registry）
  const AdapterClass = require(`./adapters/${toolName}`);
  const adapter = new AdapterClass();
  const payload = adapter.normalizePayload(input);
  payload._tool = toolName;

  // Session 文件持久化（增加 tool 字段）
  if (payload.event === 'SessionStart') {
    persistSession({ ...payload, tool: toolName });
  }

  if (payload.event === 'Stop') {
    updateSessionStop(payload);
  }

  // Socket 转发（格式不变）
  forwardToSocket(payload);

  // 通知（使用 adapter.displayName 作为标题）
  if (notifier) {
    handleNotification(payload, adapter.displayName);
  }
}
```

注意：hook-client.js 被部署到 `~/.config/claude-code-fleet/hooks/` 下，adapter 文件也需同步复制到 hooks 目录，或通过 `__dirname` 指向源码位置。`installHooks` 需处理此部署逻辑。

#### 3.4 Master.handleEvent 改造

```javascript
handleEvent(payload) {
  const sid = payload.session_id;
  if (!sid) return;

  // Worker 创建时记录工具类型
  if (!this.workers.has(sid)) {
    this.workers.set(sid, {
      // ... 现有字段保持不变
      tool: payload._tool || 'claude',    // ← 新增
    });
  }

  // PostToolUse 时委托对应 adapter 生成摘要
  if (payload.event === 'PostToolUse') {
    const worker = this.workers.get(sid);
    const adapter = registry.get(worker.tool);
    const summary = adapter.summarizeToolUse(payload.tool_name, payload.tool_input);
    // ... 使用 summary 更新 worker.lastActions / currentTurn
  }

  // 其余 SessionStart / Stop / Notification 逻辑不变
}
```

#### 3.5 `fleet hooks` 子命令

```bash
fleet hooks install                  # 自动检测已安装工具，全部注入
fleet hooks install --tools claude   # 只注入 Claude 的 hook
fleet hooks install --tools codex    # 只注入 Codex 的 hook
fleet hooks remove                   # 移除所有工具的 hook
fleet hooks status                   # 显示各工具的 hook 安装状态
```

---

### 4. TUI 展示

#### 4.1 Worker 卡片

统一列表展示，卡片标题增加工具标签（颜色区分：Claude 紫色、Codex 绿色）：

```
┌─ [Claude] abc1 · my-project ──────────────────────────────┐
│  Model: K2.6-code-preview (KIMI-部门)                      │
│  Status: working                                           │
│  > Edit src/index.js                                       │
└────────────────────────────────────────────────────────────┘

┌─ [Codex] d7f2 · api-service ─────────────────────────────┐
│  Model: gpt-5.4 (GPT-5-Codex)                             │
│  Status: idle · awaiting input                             │
│  > Bash: npm test                                          │
└────────────────────────────────────────────────────────────┘
```

#### 4.2 通知标题

从硬编码 `'Claude Code'` 改为 `adapter.displayName`。

---

### 5. 向后兼容

| 场景 | 处理策略 |
|---|---|
| `models.json` 无 `tool` 字段 | 默认 `"claude"` |
| `fleet.config.json` 无 `tool` 字段 | 默认 `"claude"` |
| `fleet model add`（无参数） | 交互式先选工具，默认高亮 Claude |
| Hook payload 无 `_tool` 标记 | 视为 Claude（兼容旧版 hook-client） |
| 只装了 Claude 未装 Codex | Codex adapter 注册但 `isInstalled()` 返回 false，不注入 hook |
| Session 文件无 `tool` 字段 | `loadPersistedSessions` 时默认 `"claude"` |

---

### 6. 改动范围

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/adapters/base.js` | 新增 | ToolAdapter 基类 |
| `src/adapters/claude.js` | 新增 | ClaudeAdapter — 逻辑从 index.js / master.js 提取 |
| `src/adapters/codex.js` | 新增 | CodexAdapter |
| `src/adapters/registry.js` | 新增 | 适配器注册与查找 |
| `src/index.js` | 修改 | `cmdRun`/`cmdUp`/`checkDeps`/`cmdModelAdd` 委托 adapter |
| `src/master.js` | 修改 | `ensureHooks`/`removeHooks` 遍历 adapter；`handleEvent` 增加 tool 字段 |
| `src/hook-client.js` | 修改 | 增加 `--tool` 参数，payload 标准化委托 adapter |
| `src/components/app.mjs` | 修改 | Worker 卡片增加工具标签和颜色 |
| `fleet.config.example.json` | 修改 | 增加 Codex 示例 instance |
| `tests/` | 修改+新增 | 新模块测试 + 现有测试适配 |

---

## Testing

- 单元测试：每个 adapter 的 `buildArgs`、`buildEnv`、`normalizePayload`、`summarizeToolUse`
- 集成测试：`installHooks` / `removeHooks` 验证文件写入正确性
- 回归测试：现有测试全部通过（向后兼容保证）
- hook-client 测试：分别模拟 `--tool claude` 和 `--tool codex` 的 stdin 输入
- TUI 测试：验证 worker 卡片正确展示工具标签

## Risks

- **Codex hook 仍为实验性**：需在 `config.toml` 开启 feature flag，API 可能变化。Mitigation：CodexAdapter 中集中管理，变化时只需改一个文件。
- **Codex PostToolUse 当前仅支持 Bash**：工具摘要粒度不如 Claude。Mitigation：随 Codex 更新迭代 CodexAdapter.summarizeToolUse。
- **Codex 无 Notification 事件**：Codex 会话不会触发桌面通知中的 notification 类型。Mitigation：Stop 事件仍可触发通知，覆盖核心场景。
