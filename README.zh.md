# Claude Code Fleet

<!-- README-I18N:START -->

[English](./README.md) | **汉语**

<!-- README-I18N:END -->

在一个终端中并行运行多个 Claude Code 实例，支持不同的 API Key、模型和端点 — 零外部依赖。

## 为什么需要

- 同时运行多个 Claude Code 工作进程（例如：Opus 负责架构设计，Sonnet 负责代码实现，Haiku 处理快速任务）
- 使用不同的 API Key 分散速率限制
- 通过不同端点或代理路由请求
- **从单一终端面板观察所有活跃的 Claude Code 进程**
- 在一个终端中管理所有实例，无需任何外部依赖

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

### 模型配置模式

管理命名的模型配置，并启动单个交互式 Claude Code 会话。

- 配置文件存储在 `~/.config/claude-code-fleet/models.json`
- `fleet run` 启动前台交互式会话，继承 `stdio`
- 如果未指定 `--model` 参数，将显示交互式箭头键选择菜单

### 观察者模式（面板）

启动实时终端面板，观察所有活跃的 Claude Code 进程。

- `fleet start` 启动观察者 TUI
- 自动发现所有 Claude Code 进程（通过 async hooks）
- 显示每个进程的会话 ID、模型名称、工作目录和最近操作
- 进程启动时自动出现，停止时自动消失
- 3 小时以上无事件的条目自动清理
- 无需配置文件 — 直接运行 `fleet start` 然后启动 Claude Code 进程即可

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
      "env": { "CUSTOM_HEADER": "value" },
      "args": ["--verbose"],
      "cwd": "./workspace/custom"
    }
  ]
}
```

## 工作原理

### 观察者模式（`fleet start`）

1. 复制 hook-client.js 到 `~/.config/claude-code-fleet/hooks/`
2. 注入 async hooks 到 `~/.claude/settings.json`（SessionStart、PostToolUse、Stop、Notification）
3. 启动 Unix socket 服务，监听 `~/.config/claude-code-fleet/fleet.sock`
4. 当任何 Claude Code 进程启动时，hooks 触发并将事件发送到 socket
5. Master 通过 `session_id` 跟踪每个会话，记录操作和模型信息
6. TUI 以 100ms 防抖渲染实时状态
7. 超过 3 小时无事件的条目自动移除

### Fleet 模式（`fleet up`）

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

内置的箭头键选择器支持：

- 方向键或 `j`/`k` 导航
- Enter 确认选择
- `q` 或 `Ctrl+C` 取消

## 许可证

MIT
