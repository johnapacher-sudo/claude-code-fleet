import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { colors } from './colors.mjs';
import { TERMINAL_NAMES } from './terminal-focus.mjs';

const h = React.createElement;

const TOOL_COLORS = {
  claude: '#a78bfa',
  codex: '#4ade80',
};

function getStatusIcon(status) {
  if (status === 'active') return { icon: '\u25CF', color: colors.running };
  if (status === 'thinking') return { icon: '\u25CF', color: colors.spinnerColor, spinning: true };
  if (status === 'offline') return { icon: '\u2717', color: colors.modelAlias };
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

function LastActions({ actions, now }) {
  if (!actions || actions.length === 0) return null;
  return h(Box, { flexDirection: 'column', paddingLeft: 1 },
    ...actions.map((a, i) =>
      h(Box, { key: i, justifyContent: 'space-between' },
        h(Box, { gap: 1 },
          h(Text, { color: colors.doneMark }, '\u2713'),
          h(Text, { color: colors.toolName }, a.tool),
          a.target ? h(Text, { color: colors.target }, a.target) : null,
        ),
        h(Text, { color: colors.idle }, formatAgo(now - a.time)),
      )
    )
  );
}

export function WorkerCard({ worker, now, isExpanded = false }) {
  const statusIcon = getStatusIcon(worker.computedStatus || worker.status);
  const elapsed = formatElapsed(now - worker.firstEventAt);

  // The previous turn(s) (for history display)
  const historyTurns = isExpanded
    ? worker.turns
    : worker.turns.length > 0 ? [worker.turns[worker.turns.length - 1]] : [];

  // Truncate message for display
  const msgText = worker.lastMessage?.text;
  const msgDisplay = msgText
    ? (msgText.length > 120 ? msgText.slice(0, 117) + '...' : msgText)
    : null;

  const isThinking = (worker.computedStatus || worker.status) === 'thinking';

  return h(Box, { flexDirection: 'column', paddingX: 1, paddingBottom: 1 },
    // Header row
    h(Box, { justifyContent: 'space-between' },
      h(Box, { gap: 1 },
        statusIcon.spinning
          ? h(Text, { color: statusIcon.color }, h(Spinner, { type: 'dots' }), ' ')
          : h(Text, { color: statusIcon.color }, statusIcon.icon),
        worker.tool && worker.tool !== 'claude'
          ? h(Text, { color: TOOL_COLORS[worker.tool] || colors.idle }, `[${worker.tool.charAt(0).toUpperCase() + worker.tool.slice(1)}] `)
          : null,
        h(Text, { color: colors.projectName, bold: true }, worker.displayName),
        worker.fleetModelName
          ? h(Text, { color: colors.modelAlias }, worker.fleetModelName)
          : null,
        worker.modelName
          ? h(Text, { color: colors.modelName }, worker.modelName)
          : null,
        worker.termProgram
          ? h(Text, { color: colors.idle }, TERMINAL_NAMES[worker.termProgram] || worker.termProgram)
          : null,
      ),
      isThinking
        ? h(Text, { color: colors.spinnerColor }, 'thinking\u2026')
        : h(Text, { color: colors.idle }, elapsed),
    ),
    // Last message (always visible, independent of turns)
    msgDisplay
      ? h(Box, { paddingLeft: 1 },
          h(Text, { color: colors.aiSummary, italic: true }, msgDisplay),
        )
      : null,
    // Current turn (expanded)
    h(CurrentTurn, { turn: worker.currentTurn, now }),
    // History turns (collapsed shows last, expanded shows all)
    ...historyTurns.map((turn, i) =>
      h(HistoryTurn, { key: `hist-${i}`, turn, now })
    ),
    // Last 3 actions (shown when no current turn is active)
    !worker.currentTurn ? h(LastActions, { actions: worker.lastActions, now }) : null,
  );
}
