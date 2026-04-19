# Claude Code Fleet

<!-- README-I18N:START -->

[English](./README.md) | **汉语**

<!-- README-I18N:END -->

在一个终端中并行运行多个 AI 编码工具实例，支持不同的 API Key、模型和端点 — 零外部依赖。支持 **Claude Code**、**GitHub Copilot CLI** 和 **Codex CLI**，具备可扩展的适配器架构以便未来接入更多工具。

## 核心特性

- **多工具支持** — 通过 Adapter 模式统一管理 Claude Code、GitHub Copilot CLI 和 Codex CLI；易于扩展其他工具
- **观察者面板** — 实时 TUI 自动发现所有 AI 编码工具进程，展示状态、操作和 AI 消息
- **终端聚焦** — 一键跳转到任意工作进程所在的终端窗口/标签页（支持 iTerm、Terminal.app、VSCode、Cursor、Warp、WezTerm）
- **会话持久化** — 工作进程在 master 重启后依然存在；会话状态持久化到磁盘并自动恢复
- **模型配置** — 命名配置文件，可快速启动使用不同模型、API Key 和代理设置的交互式会话
- **HTTP 代理** — 支持按配置或按运行设置代理；自动设置 `HTTP_PROXY` 和 `HTTPS_PROXY` 环境变量
- **交互式界面** — 方向键选择器、确认对话框、多字段输入表单，全部在终端中运行
- **桌面通知** — 工具完成任务或发送通知时弹出系统通知，支持配置提示音

## 前置要求

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)（`npm install -g @anthropic-ai/claude-code`）和/或 [GitHub Copilot CLI](https://docs.github.com/en/copilot)（`npm install -g @github/copilot`）和/或 [Codex CLI](https://developers.openai.com/codex/)（`npm install -g @openai/codex`）

## 快速开始

```bash
# 全局安装
npm install -g @dking/claude-code-fleet

# 或直接从源码运行
git clone https://github.com/<your-username>/claude-code-fleet.git
cd claude-code-fleet

# 添加模型配置（交互式）
fleet model add          # 先选择工具类型
fleet model add claude   # 添加 Claude Code 配置
fleet model add copilot  # 添加 GitHub Copilot CLI 配置
fleet model add codex    # 添加 Codex CLI 配置

# 运行单个实例（交互式选择器）
fleet run

# 启用代理运行
fleet run --proxy
fleet run --proxy http://127.0.0.1:7890
fleet run --proxy=http://127.0.0.1:7890

# 启动观察者面板
fleet start

# 配置桌面通知
fleet notify --on
fleet notify --no-sound
```

## 两种模式

### 观察者模式（面板）

启动实时终端面板，观察所有活跃的 AI 编码工具进程。

- `fleet start` 启动观察者 TUI
- 自动发现所有 Claude Code 和 Codex CLI 进程（通过 async hooks）
- 显示每个进程的会话 ID、模型名称、工具类型、工作目录、工具使用和 AI 消息
- 进程启动时自动出现，停止时（3+ 小时无事件）或进程死亡后（30 分钟）自动清理
- 会话状态持久化到磁盘 — 工作进程在 master 重启后依然存在
- 无需配置文件 — 直接运行 `fleet start` 然后启动 Claude Code 或 Codex 进程即可

### 模型配置模式

管理命名的模型配置，并启动单个交互式 AI 编码会话。

- 配置文件存储在 `~/.config/claude-code-fleet/models.json`
- 每个配置包含：名称、工具类型、模型 ID、API Key、API Base URL 和可选的代理 URL
- `fleet run`（或不带命令直接执行 `fleet`）启动前台交互式会话，继承 `stdio`
- 如果未指定 `--model` 参数，将显示交互式箭头键选择菜单
- 使用 `--proxy` 通过命令行启用代理，或使用配置中保存的代理地址

## 命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `fleet start` | — | 启动观察者面板（TUI） |
| `fleet hooks install` | — | 安装 fleet hooks 到所有已检测的工具 |
| `fleet hooks remove` | — | 从所有工具移除 fleet hooks |
| `fleet hooks status` | — | 按工具查看 hooks 安装状态 |
| `fleet run` | — | 使用模型配置启动交互式会话 |
| `fleet model add [tool]` | — | 添加新的模型配置（`claude`、`copilot`、`codex` 或交互式选择） |
| `fleet model list` | `model ls` | 列出所有已保存的模型配置 |
| `fleet model edit` | — | 交互式编辑已有的模型配置 |
| `fleet model delete` | `model rm` | 交互式删除模型配置 |
| `fleet notify` | — | 配置桌面通知（`--on`、`--off`、`--sound`、`--no-sound`） |

### 全局选项

| 参数 | 说明 |
|------|------|
| `--model <name>` | 指定模型配置（用于 `run` 命令） |
| `--cwd <path>` | 设置工作目录（用于 `run` 命令） |
| `--proxy [url]` | 启用 HTTP 代理；省略 url 时使用配置中保存的代理地址（用于 `run` 命令） |
| `--tools <names>` | 逗号分隔的工具名称（用于 `hooks install`） |

## 观察者面板

### 工作原理

1. 复制 `hook-client.js` 和适配器模块到 `~/.config/claude-code-fleet/hooks/`
2. 自动检测已安装的工具，注入 hooks 到各自的配置文件（Claude 写入 `~/.claude/settings.json`，Copilot 写入 `~/.copilot/config.json`，Codex 写入 `~/.codex/hooks.json`）
3. 启动 Unix socket 服务，监听 `~/.config/claude-code-fleet/fleet.sock`
4. 当任何工具进程触发 hook 时，客户端将标准化的 JSON 事件发送到 socket
5. Master 通过 `session_id` 跟踪每个会话，记录模型信息、工具使用和 AI 消息
6. TUI 以 100ms 防抖实时渲染
7. 会话元数据持久化到磁盘 — master 重启后自动恢复
8. 自动移除进程已死亡（30 分钟）或长期无活动（3+ 小时）的工作进程

### Hook 事件

| 事件 | Claude Code | Copilot CLI | Codex CLI | 捕获内容 |
|------|:-----------:|:-----------:|:---------:|----------|
| `SessionStart` | ✓ | ✓ | ✓ | 模型名称、工具类型、进程 PID/PPID、终端程序 |
| `PostToolUse` | ✓ | ✓ | ✓ | 工具名称和输入（Edit/Write/Read 显示文件名，Bash 显示命令，Grep 显示模式） |
| `Stop` | ✓ | ✓ | ✓ | 最后一条助手消息（截断至 500 字符），将工作进程标记为空闲 |
| `Notification` | ✓ | — | — | 以通知消息作为摘要开启新一轮对话 |

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

### Hooks

Hooks 安装在各工具的配置文件中，是持久的 — 不受 master 重启影响。当 master 未运行时，hook-client 在 < 1ms 内静默退出（不影响工具进程）。

```bash
fleet hooks install                # 自动检测工具，全部安装
fleet hooks install --tools codex  # 仅安装 Codex 的 hooks
fleet hooks install --tools copilot # 仅安装 Copilot 的 hooks
fleet hooks status                 # 按工具查看安装状态
fleet hooks remove                 # 完整卸载所有工具的 hooks
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

## 桌面通知

Claude Code 完成任务或发送通知时弹出系统通知。独立运行，无需 master/观察者进程。

### 工作原理

1. `notifier.js` 在 `fleet hooks install` 时随 `hook-client.js` 一起安装
2. `Stop` 事件触发时，发送桌面通知，以项目名作为副标题，最后一条 AI 消息作为内容
3. `Notification` 事件触发时，将通知消息转发到桌面
4. macOS 使用原生 `osascript display notification`，Linux 使用 `notify-send`，Windows 使用 PowerShell toast

### 配置

存储在 `~/.config/claude-code-fleet/notify.json`：

```json
{
  "enabled": true,
  "sound": true,
  "events": {
    "stop": true,
    "notification": true
  }
}
```

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | 总开关 |
| `sound` | `true` | 播放系统提示音 |
| `events.stop` | `true` | Claude Code 完成响应时通知 |
| `events.notification` | `true` | Claude 发送通知事件时转发 |

### 命令行

```bash
fleet notify              # 查看当前通知配置
fleet notify --on         # 开启通知
fleet notify --off        # 关闭通知
fleet notify --sound      # 开启提示音
fleet notify --no-sound   # 关闭提示音
```

## 数据与状态

所有状态存储在 `~/.config/claude-code-fleet/` 目录下：

| 路径 | 用途 |
|------|------|
| `models.json` | 已保存的模型配置 |
| `fleet.sock` | Unix 域套接字（临时的，观察者模式） |
| `hooks/hook-client.js` | 工具事件的 Hook 脚本 |
| `hooks/adapters/` | 工具适配器模块（Claude、Copilot、Codex），由 hook-client 使用 |
| `hooks/notifier.js` | 桌面通知模块（由 hook-client 加载） |
| `notify.json` | 桌面通知配置 |
| `sessions/<id>.json` | 每个会话的元数据（观察者恢复用） |

## GitHub Copilot CLI — 模型配置

添加 Copilot 模型配置与其他工具相同（`fleet model add copilot`），但有几点不同：

### 认证方式

Copilot CLI 支持两种认证路径：

| 模式 | 配置中的 `apiKey` | 行为 |
|------|---------------------|------|
| **GitHub PAT** | 带 "Copilot Requests" 权限的细粒度 PAT | `buildEnv()` 注入 `COPILOT_GITHUB_TOKEN` |
| **已登录** | 空（按 Enter 跳过） | 使用 `copilot login` 的 keychain OAuth |

`apiKey` 字段对 Copilot 配置是**可选的** — 如果你已经运行过 `copilot login`，可以直接跳过。如果提供了 PAT，它会作为 `COPILOT_GITHUB_TOKEN`（最高优先级的认证方式）传入，支持多账号并行运行。

### 必填字段

Copilot 配置仅需 **Name** 和 **Model ID**。API Key 和 API Base URL 均为可选 — Copilot 默认使用 GitHub 的模型端点。

### 环境变量

| 变量 | 来源 | 说明 |
|------|------|------|
| `COPILOT_MODEL` | `model` 字段 | 模型 ID（如 `gpt-4.1`、`gpt-4o`） |
| `COPILOT_GITHUB_TOKEN` | `apiKey` 字段 | GitHub PAT（可选 — 省略时使用 OAuth） |

> **提示**：如需同时使用不同的 GitHub 账号，请创建不同 PAT 的独立配置文件。

## 许可证

MIT
