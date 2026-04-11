import React from 'react';
import { Box, Text } from 'ink';
import { colors } from './colors.mjs';

const h = React.createElement;

export function Header({ workers }) {
  const total = workers.length;
  const running = workers.filter(w => w.computedStatus === 'active').length;
  const idle = total - running;
  const autoRunning = workers.filter(w => w.type === 'auto' && w.computedStatus === 'active').length;

  return h(Box, {
    justifyContent: 'space-between',
    paddingX: 1,
    borderStyle: 'single',
    borderColor: colors.separator,
  },
    h(Text, { color: colors.title, bold: true }, '\u2B22 Fleet Master'),
    h(Box, { gap: 1 },
      running > 0 ? h(Text, { color: colors.running }, `\u25CF ${running}`) : null,
      idle > 0 ? h(Text, { color: colors.idle }, `\u25CB ${idle}`) : null,
      autoRunning > 0 ? h(Text, { color: colors.running }, `\u2699 ${autoRunning}`) : null,
      h(Text, { color: colors.idle }, `${total} session${total !== 1 ? 's' : ''}`),
    ),
  );
}
