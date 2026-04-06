import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput, render } from 'ink';
import { Header } from './header.mjs';
import { WorkerCard } from './worker-card.mjs';
import { Footer } from './footer.mjs';
import { colors } from './colors.mjs';
import { focusTerminal } from './terminal-focus.mjs';

const h = React.createElement;

function getWorkerStatus(worker, now) {
  // Trust master's offline status (set by cleanupExpired)
  if (worker.status === 'offline') return 'offline';
  // Quick check: if ppid is known and process is dead, show offline immediately
  if (worker.ppid && !isProcessAlive(worker.ppid)) return 'offline';
  const elapsed = now - worker.lastEventAt;
  // If worker is currently executing a tool (has running action in current turn)
  const hasRunningAction = worker.currentTurn?.actions?.some(a => a.status === 'running');
  if (hasRunningAction) return 'active';
  // After Stop: waiting for user input, not thinking
  if (worker.awaitsInput) return 'idle';
  // Process alive but no running tool and recent activity → likely thinking
  if (elapsed < 10 * 60 * 1000) return 'thinking';
  // No recent activity
  return 'idle';
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function App({ master }) {
  const { exit } = useApp();
  const [, setTick] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sortMode, setSortMode] = useState('time');
  const [expanded, setExpanded] = useState(new Set());
  const [focusStatus, setFocusStatus] = useState(null);
  const focusTimerRef = useRef(null);

  // Re-render on master data changes
  useEffect(() => {
    master._renderCallback = () => setTick(t => t + 1);
    return () => { master._renderCallback = null; };
  }, []);

  // Periodic refresh for elapsed time display
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  const now = Date.now();
  const workers = [...master.workers.values()].map(w => ({
    ...w,
    computedStatus: getWorkerStatus(w, now),
  }));

  // Sort: active > thinking > idle > offline, then by sortMode
  const statusOrder = { active: 0, thinking: 1, idle: 2, offline: 3 };
  workers.sort((a, b) => {
    const sa = statusOrder[a.computedStatus] ?? 9;
    const sb = statusOrder[b.computedStatus] ?? 9;
    if (sa !== sb) return sa - sb;
    if (sortMode === 'name') return a.displayName.localeCompare(b.displayName);
    return b.lastEventAt - a.lastEventAt;
  });

  // Clamp selection when workers change
  useEffect(() => {
    if (workers.length === 0) return;
    setSelectedIdx(i => Math.min(i, workers.length - 1));
  }, [workers.length]);

  // Keyboard
  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      master.stop();
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelectedIdx(i => Math.min(i + 1, workers.length - 1));
    }
    if (key.upArrow || input === 'k') {
      setSelectedIdx(i => Math.max(i - 1, 0));
    }
    if (key.tab) {
      setSortMode(m => m === 'time' ? 'name' : 'time');
    }
    // Space: expand/collapse worker details
    if (input === ' ') {
      if (workers.length === 0) return;
      const sid = workers[selectedIdx]?.sessionId;
      if (!sid) return;
      setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(sid)) next.delete(sid);
        else next.add(sid);
        return next;
      });
    }
    // Enter: focus terminal window
    if (key.return) {
      if (workers.length === 0) return;
      const worker = workers[selectedIdx];
      if (!worker) return;

      if (!worker.termProgram) {
        setFocusStatus({ ok: false, reason: 'unknown', name: null });
      } else {
        const result = focusTerminal({
          termProgram: worker.termProgram,
          itermSessionId: worker.itermSessionId,
          cwd: worker.cwd,
          displayName: worker.displayName,
          ppid: worker.ppid,
        });
        setFocusStatus(result);
      }

      // Auto-clear after 15 seconds
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = setTimeout(() => setFocusStatus(null), 15000);
    }
    // Number keys 1-9 to jump to worker
    const num = parseInt(input, 10);
    if (num >= 1 && num <= 9 && num <= workers.length) {
      setSelectedIdx(num - 1);
    }
  });

  return h(Box, { flexDirection: 'column' },
    h(Header, { workers }),
    h(Box, { flexDirection: 'column', paddingTop: 1 },
      workers.length === 0
        ? h(Box, { paddingX: 1 },
            h(Text, { color: colors.idle },
              'No active workers. Start claude processes to see them here.',
            ),
          )
        : workers.map((w, i) =>
            h(Box, { key: w.sessionId, flexDirection: 'column' },
              h(Box, {
                flexDirection: 'column',
                borderStyle: i === selectedIdx ? 'single' : undefined,
                borderColor: i === selectedIdx ? colors.idle : undefined,
                paddingLeft: i === selectedIdx ? 0 : 1,
              },
                h(WorkerCard, { worker: w, now, isExpanded: expanded.has(w.sessionId) }),
              ),
              i < workers.length - 1
                ? h(Text, { color: colors.separator }, '\u2500'.repeat(50))
                : null,
            ),
          ),
    ),
    // Focus status feedback
    focusStatus
      ? h(Box, { paddingX: 1, flexDirection: 'column' },
          focusStatus.ok
            ? h(Text, { color: colors.running },
                `\u2713 Focused ${focusStatus.name} \u2192 ${workers[selectedIdx]?.displayName || ''}`)
            : focusStatus.reason === 'unknown'
              ? h(Text, { color: colors.slow },
                  '\u26A0 No terminal info for this worker')
              : focusStatus.reason === 'permission'
                ? h(Box, { flexDirection: 'column' },
                    h(Text, { color: colors.modelAlias },
                      '\u2717 macOS blocked focus — grant Automation access:'),
                    h(Text, { color: colors.idle },
                      '  System Settings > Privacy & Security > Automation > enable your terminal'),
                  )
                : h(Box, { flexDirection: 'column' },
                    h(Text, { color: colors.modelAlias },
                      '\u2717 Focus failed'),
                    focusStatus.detail
                      ? h(Text, { color: colors.idle },
                          `  ${focusStatus.detail}`)
                      : null,
                  ),
        )
      : null,
    h(Box, { paddingTop: 1 },
      h(Footer),
    ),
  );
}

export function createApp(master) {
  return render(h(App, { master }));
}
