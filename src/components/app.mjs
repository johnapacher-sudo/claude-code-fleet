import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useApp, useInput, render } from 'ink';
import { Header } from './header.mjs';
import { WorkerCard } from './worker-card.mjs';
import { Footer } from './footer.mjs';
import { colors } from './colors.mjs';
import { focusTerminal } from './terminal-focus.mjs';

const h = React.createElement;

const STATUS_ORDER = { active: 0, thinking: 1, idle: 2, offline: 3 };
const FILTER_MODES = ['alive', 'active', 'all'];

function getWorkerStatus(worker, now) {
  if (worker.status === 'offline') return 'offline';
  const hasRunningAction = worker.currentTurn?.actions?.some(a => a.status === 'running');
  if (hasRunningAction) return 'active';
  if (worker.awaitsInput) return 'idle';
  if (worker.currentTurn?.actions?.length > 0) {
    const allDone = worker.currentTurn.actions.every(a => a.status === 'done');
    if (allDone) {
      const lastAction = worker.currentTurn.actions[worker.currentTurn.actions.length - 1];
      const timeSinceLastAction = now - lastAction.time;
      if (timeSinceLastAction < 90 * 1000) return 'thinking';
    }
  }
  return 'idle';
}

function App({ master }) {
  const { exit } = useApp();
  const [, setTick] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sortMode, setSortMode] = useState('time');
  const [expanded, setExpanded] = useState(new Set());
  const [focusStatus, setFocusStatus] = useState(null);
  const [filterMode, setFilterMode] = useState('alive');
  const [killConfirm, setKillConfirm] = useState(null);
  const focusTimerRef = useRef(null);

  // Re-render on master data changes
  useEffect(() => {
    master._renderCallback = () => setTick(t => t + 1);
    return () => { master._renderCallback = null; };
  }, []);

  // Periodic refresh for elapsed time display (10s — no need for 5s)
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(timer);
  }, []);

  const now = Date.now();

  // Memoize workers with computed status
  const workers = useMemo(() => {
    const map = master.workers || new Map();
    return [...map.values()].map(w => ({
      ...w,
      computedStatus: getWorkerStatus(w, now),
    }));
  }, [master.workers?.size, now]);

  // Filter workers based on filterMode
  const filteredWorkers = useMemo(() => {
    if (filterMode === 'all') return workers;
    if (filterMode === 'active') return workers.filter(w => w.computedStatus === 'active' || w.computedStatus === 'thinking');
    // 'alive' — hide offline
    return workers.filter(w => w.computedStatus !== 'offline');
  }, [workers, filterMode]);

  // Sort: active > thinking > idle > offline, then by sortMode
  const sortedWorkers = useMemo(() => {
    const sorted = [...filteredWorkers];
    sorted.sort((a, b) => {
      const sa = STATUS_ORDER[a.computedStatus] ?? 9;
      const sb = STATUS_ORDER[b.computedStatus] ?? 9;
      if (sa !== sb) return sa - sb;
      if (sortMode === 'name') return a.displayName.localeCompare(b.displayName);
      return b.lastEventAt - a.lastEventAt;
    });
    return sorted;
  }, [filteredWorkers, sortMode]);

  // Viewport windowing
  const termRows = process.stdout.rows || 24;
  // Reserve: header (2) + padding (1) + footer (1) + focus status (0-3) + kill confirm (0-2) + margin (1) = ~6
  const reservedRows = 6;
  const visibleRows = Math.max(1, termRows - reservedRows);

  // Adjust viewport to keep selectedIdx centered when possible
  let viewportStart = Math.max(0, selectedIdx - Math.floor(visibleRows / 2));
  viewportStart = Math.min(viewportStart, Math.max(0, sortedWorkers.length - visibleRows));
  const viewportEnd = Math.min(viewportStart + visibleRows, sortedWorkers.length);
  const viewportWorkers = sortedWorkers.slice(viewportStart, viewportEnd);
  const aboveCount = viewportStart;
  const belowCount = sortedWorkers.length - viewportEnd;

  // Clamp selection when workers change
  useEffect(() => {
    if (sortedWorkers.length === 0) return;
    setSelectedIdx(i => Math.min(i, sortedWorkers.length - 1));
  }, [sortedWorkers.length]);

  // Keyboard
  useInput((input, key) => {
    // Kill confirmation mode
    if (killConfirm) {
      if (input === 'y' || input === 'Y') {
        master.killWorker(killConfirm.sessionId);
        setKillConfirm(null);
      } else {
        setKillConfirm(null);
      }
      return;
    }

    if (input === 'q' || (key.ctrl && input === 'c')) {
      master.stop();
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelectedIdx(i => Math.min(i + 1, sortedWorkers.length - 1));
    }
    if (key.upArrow || input === 'k') {
      setSelectedIdx(i => Math.max(i - 1, 0));
    }
    if (key.tab) {
      setSortMode(m => m === 'time' ? 'name' : 'time');
    }
    // Space: expand/collapse worker details
    if (input === ' ') {
      if (sortedWorkers.length === 0) return;
      const sid = sortedWorkers[selectedIdx]?.sessionId;
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
      if (sortedWorkers.length === 0) return;
      const worker = sortedWorkers[selectedIdx];
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

      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = setTimeout(() => setFocusStatus(null), 15000);
    }
    // Number keys 1-9 to jump to worker
    const num = parseInt(input, 10);
    if (num >= 1 && num <= 9 && num <= sortedWorkers.length) {
      setSelectedIdx(num - 1);
    }
    // f: cycle filter mode
    if (input === 'f') {
      setFilterMode(m => {
        const idx = FILTER_MODES.indexOf(m);
        return FILTER_MODES[(idx + 1) % FILTER_MODES.length];
      });
    }
    // d: kill selected worker
    if (input === 'd') {
      if (sortedWorkers.length === 0) return;
      const worker = sortedWorkers[selectedIdx];
      if (!worker) return;
      if (worker.computedStatus === 'offline') return;
      setKillConfirm(worker);
    }
  });

  // Map selectedIdx to viewport-local index
  const localIdx = selectedIdx - viewportStart;

  return h(Box, { flexDirection: 'column' },
    h(Header, { workers }),
    h(Box, { flexDirection: 'column', paddingTop: 1 },
      // Scroll indicator: workers above viewport
      aboveCount > 0
        ? h(Box, { paddingX: 1 },
            h(Text, { color: colors.idle }, `↑ ${aboveCount} more above`),
          )
        : null,
      // Viewport workers
      viewportWorkers.length === 0
        ? h(Box, { paddingX: 1 },
            h(Text, { color: colors.idle },
              filterMode === 'all'
                ? 'No active workers. Start Claude or Codex processes to see them here.'
                : `No workers matching "${filterMode}" filter. Press [f] to change filter.`,
            ),
          )
        : viewportWorkers.map((w, i) =>
            h(Box, { key: w.sessionId, flexDirection: 'column' },
              h(Box, {
                flexDirection: 'column',
                borderStyle: i === localIdx ? 'single' : undefined,
                borderColor: i === localIdx ? colors.idle : undefined,
                paddingLeft: i === localIdx ? 0 : 1,
              },
                h(WorkerCard, { worker: w, now, isExpanded: expanded.has(w.sessionId) }),
              ),
              i < viewportWorkers.length - 1
                ? h(Text, { color: colors.separator }, '─'.repeat(50))
                : null,
            ),
          ),
      // Scroll indicator: workers below viewport
      belowCount > 0
        ? h(Box, { paddingX: 1 },
            h(Text, { color: colors.idle }, `↓ ${belowCount} more below`),
          )
        : null,
    ),
    // Kill confirmation
    killConfirm
      ? h(Box, { paddingX: 1, flexDirection: 'column' },
          h(Text, { color: colors.modelAlias, bold: true },
            `⚠ Kill ${killConfirm.displayName}? (PID: ${killConfirm.ppid || 'unknown'})`),
          h(Text, { color: colors.idle },
            '  [y] confirm  [any] cancel'),
        )
      : null,
    // Focus status feedback
    focusStatus
      ? h(Box, { paddingX: 1, flexDirection: 'column' },
          focusStatus.ok
            ? h(Text, { color: colors.running },
                `✓ Focused ${focusStatus.name} → ${sortedWorkers[selectedIdx]?.displayName || ''}`)
            : focusStatus.reason === 'unknown'
              ? h(Text, { color: colors.slow },
                  '⚠ No terminal info for this worker')
              : focusStatus.reason === 'permission'
                ? h(Box, { flexDirection: 'column' },
                    h(Text, { color: colors.modelAlias },
                      '✗ macOS blocked focus — grant Automation access:'),
                    h(Text, { color: colors.idle },
                      '  System Settings > Privacy & Security > Automation > enable your terminal'),
                  )
                : h(Box, { flexDirection: 'column' },
                    h(Text, { color: colors.modelAlias },
                      '✗ Focus failed'),
                    focusStatus.detail
                      ? h(Text, { color: colors.idle },
                          `  ${focusStatus.detail}`)
                      : null,
                  ),
        )
      : null,
    h(Box, { paddingTop: 1 },
      h(Footer, { filterMode }),
    ),
  );
}

export function createApp(master) {
  return render(h(App, { master }));
}
