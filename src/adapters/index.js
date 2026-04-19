const registry = require('./registry');
const { ClaudeAdapter } = require('./claude');
const { CodexAdapter } = require('./codex');
const { CopilotAdapter } = require('./copilot');

registry.register(new ClaudeAdapter());
registry.register(new CodexAdapter());
registry.register(new CopilotAdapter());

module.exports = { registry };
