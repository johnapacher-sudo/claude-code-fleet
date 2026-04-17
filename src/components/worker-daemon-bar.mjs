import React from 'react';
import { Box, Text } from 'ink';
import { colors } from './colors.mjs';

const h = React.createElement;

export function WorkerDaemonBar({ daemonState, inputMode, inputValue, queueStats }) {
  const { running, pid, paused, concurrency } = daemonState;
  const pending = queueStats?.pending || 0;
  const active = queueStats?.running || 0;

  // Input mode — show text entry
  if (inputMode) {
    return h(Box, { paddingX: 1 },
      h(Text, { color: colors.title }, '\u2699 Add task: '),
      h(Text, { color: colors.projectName }, inputValue),
      h(Text, { color: colors.idle }, '\u2588'), // cursor block
      h(Text, { color: colors.idle }, '  '),
      h(Text, { color: colors.footer }, '[Enter] submit  [Esc] cancel'),
    );
  }

  // Stopped state
  if (!running) {
    return h(Box, { paddingX: 1 },
      h(Text, { color: colors.idle }, '\u2699 Worker: '),
      h(Text, { color: colors.modelAlias }, 'stopped'),
      h(Text, { color: colors.idle }, ' \u2502 '),
      h(Text, { color: colors.footer }, '[d] start  [a] add task'),
    );
  }

  // Paused state
  if (paused) {
    return h(Box, { paddingX: 1 },
      h(Text, { color: colors.title }, '\u2699 Worker: '),
      h(Text, { color: colors.spinnerColor }, 'paused'),
      h(Text, { color: colors.idle }, ` (pid ${pid})`),
      h(Text, { color: colors.idle }, ` \u2502 concurrency: ${concurrency}`),
      h(Text, { color: colors.idle }, ` \u2502 ${pending} pending, ${active} active`),
      h(Text, { color: colors.idle }, ' \u2502 '),
      h(Text, { color: colors.footer }, '[d] stop  [p] resume  [+/-] concurrency  [a] add'),
    );
  }

  // Running state
  return h(Box, { paddingX: 1 },
    h(Text, { color: colors.title }, '\u2699 Worker: '),
    h(Text, { color: colors.running }, 'running'),
    h(Text, { color: colors.idle }, ` (pid ${pid})`),
    h(Text, { color: colors.idle }, ` \u2502 concurrency: ${concurrency}`),
    h(Text, { color: colors.idle }, ` \u2502 ${pending} pending, ${active} active`),
    h(Text, { color: colors.idle }, ' \u2502 '),
    h(Text, { color: colors.footer }, '[d] stop  [p] pause  [+/-] concurrency  [a] add'),
  );
}
