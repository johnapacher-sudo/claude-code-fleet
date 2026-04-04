import React, { useState } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';

const h = React.createElement;

const ACCENT = '#a78bfa';
const ACCENT_DANGER = '#f85149';
const CONFIRM_GREEN = '#4ade80';
const COLOR_IDLE = '#8b949e';
const COLOR_DIM = '#525252';
const COLOR_NAME = '#d4d4d4';
const COLOR_NAME_ACTIVE = '#e0e0e0';
const COLOR_META = '#8b949e';
const BG_ACTIVE = '#161b22';
const BG_INACTIVE = '#0d1117';

function Selector({ title, items, dangerMode, onSelect, onCancel }) {
  const { exit } = useApp();
  const [selected, setSelected] = useState(0);
  const accent = dangerMode ? ACCENT_DANGER : ACCENT;

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      onCancel();
      return;
    }
    if (key.upArrow || input === 'k') {
      setSelected(i => (i - 1 + items.length) % items.length);
    }
    if (key.downArrow || input === 'j') {
      setSelected(i => (i + 1) % items.length);
    }
    if (key.return) {
      onSelect(items[selected], selected);
    }
  });

  return h(Box, { flexDirection: 'column' },
    // Title
    h(Text, { color: accent, bold: true }, `\u2B22 ${title}`),
    // Hints
    h(Text, { color: COLOR_DIM }, '\u2191\u2193 navigate \u00B7 enter select \u00B7 q cancel'),
    h(Box, { marginBottom: 1 }),
    // Cards
    ...items.map((item, i) => {
      const isActive = i === selected;
      return h(Box, {
        key: i,
        flexDirection: 'column',
        borderStyle: 'bold',
        borderLeft: true,
        borderRight: false,
        borderTop: false,
        borderBottom: false,
        borderColor: isActive ? accent : 'transparent',
        paddingLeft: 1,
        marginBottom: 1,
      },
        // Row 1: label + detail
        h(Box, { justifyContent: 'space-between', width: '100%' },
          h(Box, { gap: 1 },
            isActive
              ? h(Text, { color: accent }, '\u276F')
              : h(Text, {}, ' '),
            h(Text, {
              color: isActive ? COLOR_NAME_ACTIVE : COLOR_IDLE,
              bold: isActive,
            }, item.label),
          ),
          item.detail
            ? h(Text, { color: COLOR_DIM }, item.detail)
            : null,
        ),
        // Row 2: meta
        item.meta
          ? h(Text, { color: COLOR_META, dimColor: true }, `  ${item.meta}`)
          : null,
      );
    }),
  );
}

export function renderSelector({ title, items, dangerMode = false }) {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const app = render(
      h(Selector, {
        title,
        items,
        dangerMode,
        onSelect: (item) => {
          if (resolved) return;
          resolved = true;
          app.unmount();
          // Print confirmation line
          process.stdout.write(
            `\x1b[38;2;117;139;250m\u276F\x1b[0m ` +
            `\x1b[38;2;74;222;128m${item.label}\x1b[0m` +
            (item.detail ? ` \x1b[38;2;82;82;82m${item.detail}\x1b[0m` : '') +
            '\n'
          );
          resolve(item.value);
        },
        onCancel: () => {
          if (resolved) return;
          resolved = true;
          app.unmount();
          process.stdout.write('\x1b[38;2;82;82;82mCancelled.\x1b[0m\n');
          process.exit(1);
        },
      })
    );
  });
}
