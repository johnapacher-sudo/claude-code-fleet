import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { colors } from './colors.mjs';

const h = React.createElement;

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60);
  return `${hr}h${m % 60}m`;
}

function getStatusIcon(status) {
  if (status === 'pending') return { icon: '\u23F3', color: colors.idle };
  if (status === 'running') return { spinning: true, color: colors.spinnerColor };
  if (status === 'completed') return { icon: '\u2713', color: colors.doneMark };
  if (status === 'failed') return { icon: '\u2717', color: colors.modelAlias };
  return { icon: '?', color: colors.idle };
}

export function WorkerQueueCard({ task, now, isExpanded = false }) {
  const statusIcon = getStatusIcon(task.status);

  // Queue position display
  const queueLabel = task.queuePosition != null && task.queueTotal != null
    ? `[${task.queuePosition}/${task.queueTotal}]`
    : null;

  // Model name
  const modelLabel = task.modelProfile || 'default';

  // Elapsed time from startedAt
  let elapsed = null;
  if (task.startedAt) {
    const startedMs = new Date(task.startedAt).getTime();
    elapsed = formatElapsed(now - startedMs);
  }

  // Status icon element
  const statusElement = statusIcon.spinning
    ? h(Text, { color: statusIcon.color }, h(Spinner, { type: 'dots' }), ' ')
    : h(Text, { color: statusIcon.color }, statusIcon.icon);

  return h(Box, { flexDirection: 'column', paddingX: 1 },
    // Header row
    h(Box, { justifyContent: 'space-between' },
      h(Box, { gap: 1 },
        statusElement,
        queueLabel
          ? h(Text, { color: colors.idle }, queueLabel)
          : null,
        h(Text, { color: colors.projectName, bold: true }, task.title),
        h(Text, { color: colors.modelAlias }, modelLabel),
      ),
      elapsed
        ? h(Text, { color: colors.idle }, elapsed)
        : null,
    ),
    // Expanded details
    isExpanded
      ? h(Box, { flexDirection: 'column', paddingLeft: 1 },
          task.prompt
            ? h(Text, { color: colors.aiSummary, italic: true },
                task.prompt.length > 200
                  ? task.prompt.slice(0, 197) + '...'
                  : task.prompt,
              )
            : null,
          task.result && task.result.claudeResult
            ? h(Text, { color: colors.toolName },
                task.result.claudeResult.length > 150
                  ? task.result.claudeResult.slice(0, 147) + '...'
                  : task.result.claudeResult,
              )
            : null,
        )
      : null,
  );
}
