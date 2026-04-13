# Claude Code Fleet

<!-- README-I18N:START -->

[English](./README.md) | **汉语**

<!-- README-I18N:END -->

在一个终端中并行运行多个 Claude Code 实例，支持不同的 API Key、模型和端点 — 零外部依赖。

## 核心特性

- **观察者面板** — 实时 TUI 自动发现所有 Claude Code 进程，展示状态、操作和 AI 消息
- **终端聚焦** — 一键跳转到任意工作进程所在的终端窗口/标签页（支持 iTerm、Terminal.app、VSCode、Cursor、Warp、WezTerm）
- **会话持久化** — 工作进程在 master 重启后依然存在；会话状态持久化到磁盘并自动恢复
- **模型配置** — 命名配置文件，可快速启动使用不同模型、API Key 和代理设置的交互式会话
- **Fleet 模式** — 在配置文件中定义多个实例，作为后台进程进行管理
- **HTTP 代理** — 支持按配置或按运行设置代理；自动设置 `HTTP_PROXY` 和 `HTTPS_PROXY` 环境变量
- **交互式界面** — 方向键选择器、确认对话框、多字段输入表单，全部在终端中运行

## 前置要求

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)（`npm install -g @anthropic-ai/claude-code`）

## 快速开始

```bash
# 全局安装
npm install -g @dking/claude-code-fleet

# 或直接从源码运行
git clone https://github.com/<your-username>/claude-code-fleet.git
cd claude-code-fleet

# 添加模型配置（交互式）
fleet model add

# 运行单个实例（交互式选择器）
fleet run

# 启用代理运行
fleet run --proxy
fleet run --proxy http://127.0.0.1:7890
fleet run --proxy=http://127.0.0.1:7890

# 启动观察者面板
fleet start

# 或初始化 Fleet 配置以进行多实例管理
fleet init
# 编辑 fleet.config.json，填入你的 API Key，然后：
fleet up

# 列出运行中的实例
fleet ls

# 停止所有实例
fleet down
```

## 三种模式

### 观察者模式（面板）

启动实时终端面板，观察所有活跃的 Claude Code 进程。

- `fleet start` 启动观察者 TUI
- 自动发现所有 Claude Code 进程（通过 async hooks：SessionStart、PostToolUse、Stop、Notification）
- 显示每个进程的会话 ID、模型名称、工作目录、工具使用和 AI 消息
- 进程启动时自动出现，停止时（3+ 小时无事件）或进程死亡后（30 分钟）自动清理
- 会话状态持久化到磁盘 — 工作进程在 master 重启后依然存在
- 无需配置文件 — 直接运行 `fleet start` 然后启动 Claude Code 进程即可

### 模型配置模式

管理命名的模型配置，并启动单个交互式 Claude Code 会话。

- 配置文件存储在 `~/.config/claude-code-fleet/models.json`
- 每个配置包含：名称、模型 ID、API Key、API Base URL 和可选的代理 URL
- `fleet run`（或不带命令直接执行 `fleet`）启动前台交互式会话，继承 `stdio`
- 如果未指定 `--model` 参数，将显示交互式箭头键选择菜单
- 使用 `--proxy` 通过命令行启用代理，或使用配置中保存的代理地址

### Fleet 模式（后台）

在配置文件中定义多个实例，并将它们作为后台进程进行管理。

- `fleet up` 将每个实例作为独立后台进程启动
- PID 记录在 `~/.config/claude-code-fleet/fleet-state.json` 中
- 失效条目（已死亡的 PID）会自动清理

## 命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `fleet start` | — | 启动观察者面板（TUI） |
| `fleet hooks install` | — | 安装 fleet hooks 到 ~/.claude/settings.json |
| `fleet hooks remove` | — | 从 ~/.claude/settings.json 移除 fleet hooks |
| `fleet hooks status` | — | 查看 hooks 安装状态 |
| `fleet run` | — | 使用模型配置启动单个交互式 Claude Code 会话 |
| `fleet model add` | — | 交互式添加新的模型配置 |
| `fleet model list` | `model ls` | 列出所有已保存的模型配置 |
| `fleet model edit` | — | 交互式编辑已有的模型配置 |
| `fleet model delete` | `model rm` | 交互式删除模型配置 |
| `fleet up` | — | 将所有（或 `--only` 指定的）实例作为后台进程启动 |
| `fleet down` | `stop` | 停止所有运行中的后台实例 |
| `fleet restart` | — | 停止然后重新启动所有（或 `--only` 指定的）实例 |
| `fleet ls` | `list` | 列出当前运行中的后台实例（含 PID 和模型信息） |
| `fleet status` | — | 显示所有实例的详细配置信息 |
| `fleet init` | — | 在当前目录从模板创建 `fleet.config.json` |

### 全局选项

| 参数 | 说明 |
|------|------|
| `--config <path>` | 使用指定的配置文件，而非自动搜索 |
| `--only <names>` | 仅操作指定的实例（逗号分隔，用于 `up`/`restart`） |
| `--model <name>` | 指定模型配置（用于 `run` 命令） |
| `--cwd <path>` | 设置工作目录（用于 `run` 命令） |
| `--proxy [url]` | 启用 HTTP 代理；省略 url 时使用配置中保存的代理地址（用于 `run` 命令） |

## 配置

### 配置文件搜索顺序

1. 当前目录下的 `fleet.config.local.json`（已 gitignore，用于本地密钥）
2. 当前目录下的 `fleet.config.json`
3. `~/.config/claude-code-fleet/config.json`（全局回退）

### 实例选项

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | 唯一的实例名称 |
| `apiKey` | 是 | Anthropic API Key（设置为 `ANTHROPIC_AUTH_TOKEN`） |
| `model` | 否 | Claude 模型 ID（例如 `claude-opus-4-6`、`claude-sonnet-4-6`） |
| `apiBaseUrl` | 否 | 自定义 API 端点（设置为 `ANTHROPIC_BASE_URL`） |
| `cwd` | 否 | 实例的工作目录（不存在时自动创建） |
| `env` | 否 | 额外的环境变量，以键值对形式 |
| `args` | 否 | 传递给 `claude` 的额外 CLI 参数 |
| `proxy` | 否 | HTTP 代理 URL（设置 `HTTP_PROXY` 和 `HTTPS_PROXY`） |

### 示例配置

```json
{
  "instances": [
    {
      "name": "opus-worker",
      "apiKey": "sk-ant-api03-xxxxx",
      "model": "claude-opus-4-6",
      "apiBaseUrl": "https://api.anthropic.com",
      "cwd": "./workspace/opus"
    },
    {
      "name": "sonnet-worker",
      "apiKey": "sk-ant-api03-yyyyy",
      "model": "claude-sonnet-4-6",
      "cwd": "./workspace/sonnet"
    },
    {
      "name": "custom-endpoint",
      "apiKey": "your-key",
      "model": "claude-sonnet-4-6",
      "apiBaseUrl": "https://your-proxy.example.com/v1",
      "proxy": "http://127.0.0.1:7890",
      "env": { "CUSTOM_HEADER": "value" },
      "args": ["--verbose"],
      "cwd": "./workspace/custom"
    }
  ]
}
```

## 观察者面板

### 工作原理

1. 复制 `hook-client.js` 到 `~/.config/claude-code-fleet/hooks/`
2. 注入 async hooks 到 `~/.claude/settings.json`，监听四个 Claude Code 事件
3. 启动 Unix socket 服务，监听 `~/.config/claude-code-fleet/fleet.sock`
4. 当任何 Claude Code 进程触发 hook 时，客户端将 JSON 事件发送到 socket
5. Master 通过 `session_id` 跟踪每个会话，记录模型信息、工具使用和 AI 消息
6. TUI 以 100ms 防抖实时渲染
7. 会话元数据持久化到磁盘 — master 重启后自动恢复
8. 自动移除进程已死亡（30 分钟）或长期无活动（3+ 小时）的工作进程

### Hook 事件

| 事件 | 捕获内容 |
|------|----------|
| `SessionStart` | 模型名称、进程 PID/PPID、终端程序、iTerm 会话 ID |
| `PostToolUse` | 工具名称和输入（Edit/Write/Read 显示文件名，Bash 显示命令，Grep 显示模式） |
| `Stop` | 最后一条助手消息（截断至 500 字符），将工作进程标记为空闲 |
| `Notification` | 以通知消息作为摘要开启新一轮对话 |

### 工作进程状态

| 状态 | 含义 |
|------|------|
| `active` | 工作进程正在执行工具操作 |
| `thinking` | 当前轮次所有操作已完成，但 90 秒内有活动（显示旋转动画） |
| `idle` | 工作进程已完成，等待用户输入 |
| `offline` | 进程已死亡或被 master 标记 |

工作进程按状态优先级排序（active → thinking → idle → offline），同级按最后事件时间或字母顺序排列（用 Tab 切换）。

### 键盘控制

| 按键 | 功能 |
|------|------|
| `j` / ↓ | 向下滚动 |
| `k` / ↑ | 向上滚动 |
| `1`–`9` | 按位置跳转到工作进程 |
| Space | 展开/折叠工作进程详情视图 |
| Enter | 聚焦到该工作进程所在的终端窗口/标签页 |
| Tab | 切换排序模式（按时间 / 按名称） |
| `q` / Ctrl+C | 退出 |

### 终端聚焦

在任何工作进程上按 Enter 即可跳转到其所在的终端窗口/标签页。支持的终端（仅 macOS）：

| 终端 | 方式 |
|------|------|
| **iTerm2** | 通过 AppleScript 按 ID 选择特定会话 |
| **Terminal.app** | 通过 PID 查找 TTY 设备，通过 AppleScript 选择匹配的标签页 |
| **VSCode** | 使用 `open -a "Visual Studio Code"` 打开工作区目录 |
| **Cursor** | 使用 `open -a "Cursor"` 打开工作区目录 |
| **Warp** | 通过 AppleScript 激活包含该工作进程的窗口 |
| **WezTerm** | 通过 AppleScript 激活包含该工作进程的窗口 |

如果未授予自动化权限，会显示清晰的错误信息和操作指引。

## Fleet 模式

### 工作原理

1. 读取配置文件获取实例定义
2. 验证配置（必填字段、名称唯一性）
3. 检查 `claude` CLI 是否可用
4. 将每个实例作为独立后台进程启动，应用配置的模型和环境变量
5. 在状态文件中跟踪 PID 以进行生命周期管理
6. 每次操作时自动清理失效条目

### Hooks

Hooks 安装在 `~/.claude/settings.json` 中，是持久的 — 不受 master 重启影响。当 master 未运行时，hook-client 在 < 1ms 内静默退出（不影响 Claude Code）。

```bash
fleet hooks install   # 一次性安装
fleet hooks status    # 检查安装状态
fleet hooks remove    # 完整卸载
```

## 交互式界面

所有交互式提示均基于 Ink（终端中的 React 框架）构建：

### 选择器（方向键菜单）

- 方向键或 `j`/`k` 导航
- Enter 确认选择
- `q` 或 Ctrl+C 取消
- 支持危险模式（红色强调，用于删除等破坏性操作）

### 确认对话框

- Yes/No 确认，可选危险样式
- `y`/Enter 确认，`n`/`q`/Escape 取消

### 输入表单

- 多字段表单，支持上/下/Tab 导航
- 内联文本编辑，支持退格/删除
- 必填字段验证，带错误高亮
- 提交时自动跳转到第一个空的必填字段

## 数据与状态

所有状态存储在 `~/.config/claude-code-fleet/` 目录下：

| 路径 | 用途 |
|------|------|
| `models.json` | 已保存的模型配置 |
| `fleet-state.json` | 后台实例 PID（Fleet 模式） |
| `fleet.sock` | Unix 域套接字（临时的，观察者模式） |
| `hooks/hook-client.js` | Claude Code 事件的 Hook 脚本 |
| `sessions/<id>.json` | 每个会话的元数据（观察者恢复用） |

## 许可证

MIT
