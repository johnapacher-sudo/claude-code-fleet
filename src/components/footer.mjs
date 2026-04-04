import React from 'react';
import { Box, Text } from 'ink';
import { colors } from './colors.mjs';

const h = React.createElement;

export function Footer() {
  return h(Box, {
    justifyContent: 'space-between',
    paddingX: 1,
  },
    h(Text, { color: colors.footer },
      '[j/k] scroll  [enter] expand  [1-9] filter'
    ),
    h(Text, { color: colors.footer }, '[q] quit'),
  );
}
