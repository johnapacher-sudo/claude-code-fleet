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

function ConfirmDialog({ title, items, dangerMode, onConfirm, onCancel }) {
  const { exit } = useApp();
  const accent = dangerMode ? ACCENT_DANGER : ACCENT;

  useInput((input, key) => {
    if (input === 'y' || input === 'Y') {
      onConfirm();
    } else if (input === 'n' || input === 'N' || input === 'q' || (key.ctrl && input === 'c')) {
      onCancel();
    }
  });

  return h(Box, { flexDirection: 'column' },
    h(Text, { color: accent, bold: true }, `\u26A0 ${title}`),
    h(Box, { marginBottom: 1 }),
    // Warning card
    h(Box, {
      flexDirection: 'column',
      borderStyle: 'bold',
      borderLeft: true,
      borderRight: false,
      borderTop: false,
      borderBottom: false,
      borderColor: accent,
      paddingLeft: 1,
    },
      h(Box, { justifyContent: 'space-between' },
        h(Text, { color: '#e0e0e0', bold: true }, items.label),
        h(Text, { color: '#525252' }, items.detail || ''),
      ),
      items.meta
        ? h(Text, { color: '#8b949e', dimColor: true }, `  ${items.meta}`)
        : null,
    ),
    h(Box, { marginBottom: 1 }),
    // y/n prompt
    h(Text, {},
      h(Text, { color: '#4ade80' }, 'y') + ' confirm  \u00B7 ',
      h(Text, { color: '#525252' }, 'n') + ' cancel',
    ),
  );
}

export function renderConfirm({ title, items, dangerMode = false }) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const accent = dangerMode ? '#f85149' : '#a78bfa';

    const app = render(
      h(ConfirmDialog, {
        title,
        items,
        dangerMode,
        onConfirm: () => {
          if (resolved) return;
          resolved = true;
          app.unmount();
          process.stdout.write(
            `\x1b[38;2;74;222;128m\u2714\x1b[0m ` +
            `\x1b[38;2;74;222;128m${items.label}\x1b[0m` +
            (items.detail ? ` \x1b[38;2;82;82;82m${items.detail}\x1b[0m` : '') +
            '\n'
          );
          resolve(items.value);
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

function FormField({ field, isActive, value, onChange }) {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(value || '');

  useInput((input, key) => {
    if (key.leftArrow) {
      const before = cursor.slice(0, -1);
      onChange(field, before);
      setCursor(before);
    } else if (key.rightArrow || key.tab) {
      // Move to next field (parent handles this)
      return;
    } else if (key.backspace || key.delete) {
      const before = cursor.slice(0, -1);
      onChange(field, before);
      setCursor(before);
    } else if (key.return) {
      return;
    } else if (input && !key.ctrl) {
      const newVal = cursor + input;
      onChange(field, newVal);
      setCursor(newVal);
    }
  });

  const displayValue = value || '';
  const cursorPos = cursor.length;
  const before = displayValue.slice(0, cursorPos);
  const after = displayValue.slice(cursorPos);

  return h(Box, { gap: 1 },
    h(Text, { color: isActive ? '#a78bfa' : '#8b949e', bold: isActive }, `${field.label}:`),
    h(Text, { color: '#e0e0e0' },
      `${before}`,
      isActive ? h(Text, { color: '#a78bfa', inverse: true }, '\u2588') : null,
      `${after}`,
    ),
    field.placeholder && !value
      ? h(Text, { color: '#525252', dimColor: true }, ` (${field.placeholder})`)
      : null,
  );
}

function InputForm({ title, fields, values, onSubmit, onCancel }) {
  const { exit } = useApp();
  const [currentField, setCurrentField] = useState(0);
  const [formValues, setFormValues] = useState(values || {});

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      onCancel();
      return;
    }
    if (key.upArrow || (input === 'k' && !key.ctrl)) {
      setCurrentField(i => (i - 1 + fields.length) % fields.length);
    }
    if (key.downArrow || (input === 'j' && !key.ctrl)) {
      setCurrentField(i => (i + 1) % fields.length);
    }
    if (key.tab || (key.rightArrow && !key.ctrl)) {
      setCurrentField(i => (i + 1) % fields.length);
    }
    if (key.return) {
      onSubmit(formValues);
    }
  });

  const handleChange = (fieldName, newVal) => {
    setFormValues(prev => ({ ...prev, [fieldName]: newVal }));
  };

  return h(Box, { flexDirection: 'column' },
    h(Text, { color: '#a78bfa', bold: true }, `\u2B22 ${title}`),
    h(Text, { color: '#525252' }, '\u2191\u2193 navigate \u00B7 tab next field \u00B7 enter confirm \u00B7 q cancel'),
    h(Box, { marginBottom: 1 }),
    ...fields.map((field, i) => {
      const isActive = i === currentField;
      return h(FormField, {
        key: field.label,
        field,
        isActive,
        value: formValues[field.label] || field.value,
        onChange: handleChange,
      });
    }),
  );
}

export function renderInput({ title, fields }) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const initialValues = {};
    fields.forEach(f => { initialValues[f.label] = f.value || ''; });

    const app = render(
      h(InputForm, {
        title,
        fields,
        values: initialValues,
        onSubmit: (values) => {
          if (resolved) return;
          resolved = true;
          app.unmount();
          process.stdout.write(
            `\x1b[38;2;74;222;128m\u2714\x1b[0m ` +
            `\x1b[38;2;74;222;128m${title}\x1b[0m\n`
          );
          resolve(values);
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
