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
npm install -g claude-code-fleet

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

## 两种模式

### 模型配置模式

管理命名的模型配置，并启动单个交互式 Claude Code 会话。

- 配置文件存储在 `~/.config/claude-code-fleet/models.json`
- `fleet run` 启动前台交互式会话，继承 `stdio`
- 如果未指定 `--model` 参数，将显示交互式箭头键选择菜单

### Fleet 模式

在配置文件中定义多个实例，并将它们作为后台进程进行管理。

- `fleet up` 将每个实例作为独立后台进程启动
- PID 记录在 `~/.config/claude-code-fleet/fleet-state.json` 中
- 失效条目（已死亡的 PID）会自动清理

## 命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `fleet run` | — | 使用模型配置启动单个交互式 Claude Code 会话 |
| `fleet model add` | — | 交互式添加新的模型配置 |
| `fleet model list` | `model ls` | 列出所有已保存的模型配置 |
| `fleet model edit` | — | 交互式编辑已有的模型配置 |
| `fleet model delete` | `model rm` | 交互式删除模型配置 |
| `fleet up` | `start` | 将所有（或 `--only` 指定的）实例作为后台进程启动 |
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
