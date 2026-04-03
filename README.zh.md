# Claude Code Fleet

<!-- README-I18N:START -->

[English](./README.md) | **汉语**

<!-- README-I18N:END -->

在一个终端中并行运行多个 Claude Code 实例，支持不同的 API Key、模型和端点 — 零外部依赖。

## 为什么需要

- 同时运行多个 Claude Code 工作进程（例如：Opus 负责架构设计，Sonnet 负责代码实现，Haiku 处理快速任务）
- 使用不同的 API Key 分散速率限制
- 通过不同端点或代理路由请求
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

### Fleet 模式（后台）

在配置文件中定义多个实例，并将它们作为后台进程进行管理。

- `fleet up` 将每个实例作为独立后台进程启动
- PID 记录在 `~/.config/claude-code-fleet/fleet-state.json` 中
- 失效条目（已死亡的 PID）会自动清理

### Master 模式（带 TUI）

启动 master 守护进程，通过实时终端 TUI 面板编排多个 worker。Worker 自主执行任务队列中的任务，进度、工具使用和错误通过 Claude Code hooks 上报。

- `fleet start` 启动 master + 所有 worker，显示 TUI 面板
- Worker 通过 hook 注入的配置运行 `claude -p`，自动上报进度
- 每个 worker 独立的任务队列：任务按顺序执行，前一个完成后自动开始下一个
- 通过 TUI 输入或 `fleet task add` 动态追加任务
- `fleet stop`（TUI 中 Ctrl+Q）分离 master，worker 继续运行

## 命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `fleet run` | — | 使用模型配置启动单个交互式 Claude Code 会话 |
| `fleet model add` | — | 交互式添加新的模型配置 |
| `fleet model list` | `model ls` | 列出所有已保存的模型配置 |
| `fleet model edit` | — | 交互式编辑已有的模型配置 |
| `fleet model delete` | `model rm` | 交互式删除模型配置 |
| `fleet up` | `start` | 将所有（或 `--only` 指定的）实例作为后台进程启动 |
| `fleet start` | — | 启动 master 守护进程 + TUI + 所有 worker |
| `fleet task add <worker> <task>` | — | 向运行中的 worker 追加任务 |
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
| `tasks` | 否 | Worker 的初始任务队列（master 模式下使用） |

### 任务队列（Master 模式）

在 master 模式下，每个 worker 拥有独立的任务队列。可在配置中定义初始任务：

```json
{
  "name": "opus-worker",
  "apiKey": "sk-ant-xxx",
  "model": "claude-opus-4-6",
  "cwd": "./workspace/opus",
  "tasks": [
    "分析项目架构，输出设计文档",
    "重构 src/core.js 为模块化结构",
    "编写核心模块的单元测试"
  ]
}
```

Worker 按顺序执行任务。当一个任务完成时（Claude Code 的 `Stop` hook 触发），master 自动下发队列中的下一个任务。如果队列为空，worker 进入空闲状态。

运行时可通过以下方式动态追加任务：
- TUI：选中 worker，按 Enter，输入任务描述
- CLI：`fleet task add opus-worker "修复认证模块"`

### 示例

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

1. 读取配置文件获取实例定义
2. 验证配置（必填字段、名称唯一性）
3. 检查 `claude` CLI 是否可用
4. 将每个实例作为独立后台进程启动，应用配置的模型和环境变量
5. 在状态文件中跟踪 PID 以进行生命周期管理
6. 每次操作时自动清理失效条目

## 交互式界面

内置的箭头键选择器支持：

- 方向键或 `j`/`k` 导航
- Enter 确认选择
- `q` 或 `Ctrl+C` 取消

## 许可证

MIT
