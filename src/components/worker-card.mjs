import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { colors } from './colors.mjs';

const h = React.createElement;

function getStatusIcon(status) {
  if (status === 'active' || status === 'running') return { icon: '\u25CF', color: colors.running };
  if (status === 'slow') return { icon: '\u25CF', color: colors.slow };
  return { icon: '\u25CB', color: colors.idle };
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60);
  return `${hr}h${m % 60}m`;
}

function formatAgo(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const hr = Math.floor(m / 60);
  return `${hr}h ago`;
}

function ActionLine({ action, now }) {
  if (action.status === 'running') {
    return h(Box, { justifyContent: 'space-between' },
      h(Box, { gap: 1 },
        h(Box, { gap: 0 },
          h(Text, { color: colors.spinnerColor },
            h(Spinner, { type: 'dots' }),
          ),
          h(Text, { color: colors.spinnerColor }, ' '),
        ),
        h(Text, { color: colors.spinnerColor }, action.tool),
        action.target ? h(Text, { color: colors.target }, ' ', action.target) : null,
      ),
      h(Text, { color: colors.spinnerColor }, 'running\u2026'),
    );
  }
  return h(Box, { justifyContent: 'space-between' },
    h(Box, { gap: 1 },
      h(Text, { color: colors.doneMark }, '\u2713'),
      h(Text, { color: colors.toolName }, action.tool),
      action.target ? h(Text, { color: colors.target }, action.target) : null,
    ),
    h(Text, { color: colors.idle }, formatAgo(now - action.time)),
  );
}

function CurrentTurn({ turn, now }) {
  if (!turn) return null;
  const recentActions = turn.actions.slice(-3);
  const hasContent = turn.summary || recentActions.length > 0;
  if (!hasContent) return null;

  return h(Box, {
    borderStyle: 'bold',
    borderLeft: true,
    borderRight: false,
    borderTop: false,
    borderBottom: false,
    borderColor: colors.activeLine,
    paddingLeft: 1,
    flexDirection: 'column',
    gap: 0,
  },
    turn.summary
      ? h(Text, { color: colors.aiSummary, italic: true },
          turn.summary.length > 80
            ? turn.summary.slice(0, 77) + '...'
            : turn.summary,
        )
      : null,
    ...recentActions.map((action, i) =>
      h(ActionLine, { key: i, action, now })
    ),
  );
}

function HistoryTurn({ turn, now }) {
  if (!turn) return null;
  const hasContent = turn.summary || turn.actions.length > 0;
  if (!hasContent) return null;

  const toolNames = turn.actions.map(a => a.tool);
  const collapsed = toolNames.length <= 3
    ? toolNames.join(' \u2192 ')
    : toolNames.slice(0, 3).join(' \u2192 ') + ` +${toolNames.length - 3}`;

  return h(Box, {
    borderStyle: 'bold',
    borderLeft: true,
    borderRight: false,
    borderTop: false,
    borderBottom: false,
    borderColor: colors.historyLine,
    paddingLeft: 1,
    flexDirection: 'column',
    gap: 0,
  },
    turn.summary
      ? h(Text, { color: colors.historyLine, italic: true },
          turn.summary.length > 80
            ? turn.summary.slice(0, 77) + '...'
            : turn.summary,
        )
      : null,
    h(Box, { justifyContent: 'space-between' },
      h(Text, { color: colors.historyLine },
        '\u2713 ',
        collapsed,
      ),
      h(Text, { color: colors.historyLine },
        formatAgo(now - turn.summaryTime),
      ),
    ),
  );
}

export function WorkerCard({ worker, now, isExpanded = false }) {
  const statusIcon = getStatusIcon(worker.status);
  const elapsed = formatElapsed(now - worker.firstEventAt);

  // The previous turn(s) (for history display)
  const historyTurns = isExpanded
    ? worker.turns
    : worker.turns.length > 0 ? [worker.turns[worker.turns.length - 1]] : [];

  return h(Box, { flexDirection: 'column', paddingX: 1, paddingBottom: 1 },
    // Header row
    h(Box, { justifyContent: 'space-between' },
      h(Box, { gap: 1 },
        h(Text, { color: statusIcon.color }, statusIcon.icon),
        h(Text, { color: colors.projectName, bold: true }, worker.displayName),
        worker.fleetModelName
          ? h(Text, { color: colors.modelAlias }, worker.fleetModelName)
          : null,
        worker.modelName
          ? h(Text, { color: colors.modelName }, worker.modelName)
          : null,
      ),
      h(Text, { color: colors.idle }, elapsed),
    ),
    // Current turn (expanded)
    h(CurrentTurn, { turn: worker.currentTurn, now }),
    // History turns (collapsed shows last, expanded shows all)
    ...historyTurns.map((turn, i) =>
      h(HistoryTurn, { key: `hist-${i}`, turn, now })
    ),
  );
}
