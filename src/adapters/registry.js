const adapters = new Map();

function register(adapter) { adapters.set(adapter.name, adapter); }
function get(name) { return adapters.get(name); }
function all() { return [...adapters.values()]; }
function installed() { return all().filter(a => a.isInstalled()); }
function detect(payload) { return payload._tool || 'claude'; }
function reset() { adapters.clear(); }

module.exports = { register, get, all, installed, detect, reset };
