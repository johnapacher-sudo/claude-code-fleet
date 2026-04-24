import React from 'react';
import { Box, Text } from 'ink';
import { colors } from './colors.mjs';

const h = React.createElement;

function HeaderInner({ workers }) {
  const total = workers.length;
  const running = workers.filter(w => w.computedStatus === 'active').length;
  const thinking = workers.filter(w => w.computedStatus === 'thinking').length;
  const offline = workers.filter(w => w.computedStatus === 'offline').length;
  const idle = total - running - thinking - offline;

  return h(Box, {
    justifyContent: 'space-between',
    paddingX: 1,
    borderStyle: 'single',
    borderColor: colors.separator,
  },
    h(Text, { color: colors.title, bold: true }, '⬢ Fleet Master'),
    h(Box, { gap: 1 },
      running > 0 ? h(Text, { color: colors.running }, `● ${running}`) : null,
      thinking > 0 ? h(Text, { color: colors.spinnerColor }, `● ${thinking}`) : null,
      idle > 0 ? h(Text, { color: colors.idle }, `○ ${idle}`) : null,
      offline > 0 ? h(Text, { color: colors.modelAlias }, `✗ ${offline}`) : null,
      h(Text, { color: colors.idle }, `${total} session${total !== 1 ? 's' : ''}`),
    ),
  );
}

export const Header = React.memo(HeaderInner);
