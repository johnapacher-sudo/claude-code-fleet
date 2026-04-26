const { spawnSync } = require('child_process');

class ToolAdapter {
  get name() { throw new Error('ToolAdapter.name must be implemented'); }
  get displayName() { throw new Error('ToolAdapter.displayName must be implemented'); }
  get binary() { throw new Error('ToolAdapter.binary must be implemented'); }
  get hookEvents() { throw new Error('ToolAdapter.hookEvents must be implemented'); }

  isInstalled() {
    const r = spawnSync('which', [this.binary], { encoding: 'utf-8', stdio: 'pipe' });
    return r.status === 0;
  }

  buildArgs(_entry) { throw new Error('ToolAdapter.buildArgs must be implemented'); }
  buildEnv(_entry, _baseEnv) { throw new Error('ToolAdapter.buildEnv must be implemented'); }
  installHooks(_hookClientPath) { throw new Error('ToolAdapter.installHooks must be implemented'); }
  removeHooks() { throw new Error('ToolAdapter.removeHooks must be implemented'); }
  normalizePayload(_rawInput) { throw new Error('ToolAdapter.normalizePayload must be implemented'); }
  classifyFailure(_result) {
    return { kind: 'terminal', reason: 'unclassified' };
  }

  summarizeToolUse(toolName, _toolInput) {
    return toolName;
  }
}

module.exports = { ToolAdapter };
