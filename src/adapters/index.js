const registry = require('./registry');
const { ClaudeAdapter } = require('./claude');
const { CodexAdapter } = require('./codex');

registry.register(new ClaudeAdapter());
registry.register(new CodexAdapter());

module.exports = { registry };
