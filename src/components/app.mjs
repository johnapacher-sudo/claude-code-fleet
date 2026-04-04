import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput, render } from 'ink';
import { Header } from './header.mjs';
import { WorkerCard } from './worker-card.mjs';
import { Footer } from './footer.mjs';
import { colors } from './colors.mjs';

const h = React.createElement;

function getWorkerStatus(worker, now) {
  if (worker.status === 'idle') return 'idle';
  const elapsed = now - worker.lastEventAt;
  if (elapsed > 10 * 60 * 1000) return 'slow';
  return 'active';
}

function App({ master }) {
  const { exit } = useApp();
  const [, setTick] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(0);

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

  // Sort: active > slow > idle, then by lastEventAt desc
  const statusOrder = { active: 0, slow: 1, idle: 2 };
  workers.sort((a, b) => {
    const sa = statusOrder[a.computedStatus] ?? 9;
    const sb = statusOrder[b.computedStatus] ?? 9;
    if (sa !== sb) return sa - sb;
    return b.lastEventAt - a.lastEventAt;
  });

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
    if (key.return) {
      // Toggle expand — for now just visual indicator
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
            h(Box, {
              key: w.sessionId,
              flexDirection: 'column',
              borderStyle: i === selectedIdx ? 'single' : undefined,
              borderColor: i === selectedIdx ? colors.idle : undefined,
              paddingLeft: i === selectedIdx ? 0 : 1,
            },
              h(WorkerCard, { worker: w, now }),
            ),
          ),
    ),
    h(Box, { paddingTop: 1 },
      h(Footer),
    ),
  );
}

export function createApp(master) {
  return render(h(App, { master }));
}
