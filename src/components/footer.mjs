import React from 'react';
import { Box, Text } from 'ink';
import { colors } from './colors.mjs';

const h = React.createElement;

export function Footer({ filterMode }) {
  const filterLabel = filterMode === 'alive'
    ? 'alive'
    : filterMode === 'active'
      ? 'active'
      : 'all';

  return h(Box, {
    justifyContent: 'space-between',
    paddingX: 1,
  },
    h(Box, { gap: 1 },
      h(Text, { color: colors.footer },
        '[j/k] scroll  [space] expand  [enter] focus  [1-9] jump'),
      h(Text, { color: colors.footer }, '|'),
      h(Text, { color: colors.footer },
        `[d] kill  [f] filter:${filterLabel}`),
    ),
    h(Text, { color: colors.footer }, '[q] quit'),
  );
}
