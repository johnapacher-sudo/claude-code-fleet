import React, { useState, useEffect } from 'react';
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

// ─── Selector ────────────────────────────────────────────────────────────────

function Selector({ title, items, dangerMode, onSelect, onCancel }) {
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
    h(Text, { color: accent, bold: true }, `\u2B22 ${title}`),
    h(Text, { color: COLOR_DIM }, '\u2191\u2193 navigate \u00B7 enter select \u00B7 q cancel'),
    h(Box, { marginBottom: 1 }),
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
        item.meta
          ? h(Text, { color: COLOR_META, dimColor: true }, `  ${item.meta}`)
          : null,
        item.warning && isActive
          ? h(Text, { color: '#fbbf24', bold: true }, `  \u26A0 ${item.warning}`)
          : item.warning
            ? h(Text, { color: '#525252' }, `  \u26A0 ${item.warning}`)
            : null,
      );
    }),
  );
}

export function renderSelector({ title, items, dangerMode = false }) {
  return new Promise((resolve) => {
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
          resolve(null);
        },
      })
    );
  });
}

// ─── Confirm Dialog ──────────────────────────────────────────────────────────

function ConfirmDialog({ title, items, dangerMode, onConfirm, onCancel }) {
  const accent = dangerMode ? ACCENT_DANGER : ACCENT;

  useInput((input, key) => {
    if (input === 'y' || input === 'Y' || key.return) {
      onConfirm();
    } else if (input === 'n' || input === 'N' || input === 'q' || (key.ctrl && input === 'c') || key.escape) {
      onCancel();
    }
  });

  return h(Box, { flexDirection: 'column' },
    h(Text, { color: accent, bold: true }, `\u26A0 ${title}`),
    h(Box, { marginBottom: 1 }),
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
    h(Text, {},
      h(Text, { color: CONFIRM_GREEN }, 'y/enter'), ' confirm  \u00B7 ',
      h(Text, { color: '#525252' }, 'n/esc'), ' cancel',
    ),
  );
}

export function renderConfirm({ title, items, dangerMode = false }) {
  return new Promise((resolve) => {
    let resolved = false;

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
          resolve(true);
        },
        onCancel: () => {
          if (resolved) return;
          resolved = true;
          app.unmount();
          process.stdout.write('\x1b[38;2;82;82;82mCancelled.\x1b[0m\n');
          resolve(false);
        },
      })
    );
  });
}

// ─── Input Form ──────────────────────────────────────────────────────────────

function FormField({ field, isActive, value, error }) {
  const displayValue = value || '';

  return h(Box, { gap: 1 },
    h(Text, { color: isActive ? (error ? '#f85149' : '#a78bfa') : '#8b949e', bold: isActive },
      `${field.label}:`),
    h(Box, {},
      h(Text, { color: error ? '#f85149' : '#e0e0e0' },
        displayValue,
        isActive ? h(Text, { color: error ? '#f85149' : '#a78bfa', inverse: true }, '\u2588') : null,
      ),
      !displayValue && field.placeholder
        ? h(Text, { color: error ? '#f85149' : '#525252', dimColor: !error },
            error ? ` (${field.label} is required)` : ` (${field.placeholder})`)
        : null,
    ),
  );
}

function InputForm({ title, fields, values: initialValues, requiredFields, onSubmit, onCancel }) {
  const [currentField, setCurrentField] = useState(0);
  const [formValues, setFormValues] = useState(initialValues || {});
  const [validationErrors, setValidationErrors] = useState({});
  const [triedSubmit, setTriedSubmit] = useState(false);

  useInput((input, key) => {
    // Cancel
    if (key.ctrl && input === 'c') {
      onCancel();
      return;
    }
    // Only q on non-text fields or with Ctrl
    if (input === 'q' && key.ctrl) {
      onCancel();
      return;
    }
    // Escape cancels
    if (key.escape) {
      onCancel();
      return;
    }

    // Navigation
    if (key.upArrow) {
      setCurrentField(i => (i - 1 + fields.length) % fields.length);
      return;
    }
    if (key.downArrow) {
      setCurrentField(i => (i + 1) % fields.length);
      return;
    }
    if (key.tab) {
      setCurrentField(i => (i + 1) % fields.length);
      return;
    }

    // Editing the current field
    const field = fields[currentField];
    const currentVal = formValues[field.label] || '';

    if (key.backspace || key.delete) {
      const newVal = currentVal.slice(0, -1);
      setFormValues(prev => ({ ...prev, [field.label]: newVal }));
      // Clear error for this field if user is editing
      if (validationErrors[field.label]) {
        setValidationErrors(prev => {
          const next = { ...prev };
          delete next[field.label];
          return next;
        });
      }
      return;
    }

    if (key.return) {
      // Check required fields
      const required = requiredFields || [];
      const errors = {};
      let firstEmpty = -1;
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        if (required.includes(f.label) && !formValues[f.label]) {
          errors[f.label] = true;
          if (firstEmpty === -1) firstEmpty = i;
        }
      }

      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
        setTriedSubmit(true);
        // Jump to first empty required field
        if (firstEmpty !== -1) setCurrentField(firstEmpty);
        return;
      }

      onSubmit(formValues);
      return;
    }

    // Regular text input — only accept printable chars
    if (input && !key.ctrl && !key.meta) {
      const newVal = currentVal + input;
      setFormValues(prev => ({ ...prev, [field.label]: newVal }));
      // Clear error for this field
      if (validationErrors[field.label]) {
        setValidationErrors(prev => {
          const next = { ...prev };
          delete next[field.label];
          return next;
        });
      }
    }
  });

  return h(Box, { flexDirection: 'column' },
    h(Text, { color: '#a78bfa', bold: true }, `\u2B22 ${title}`),
    h(Text, { color: COLOR_DIM },
      '\u2191\u2193 navigate \u00B7 type to edit \u00B7 tab next \u00B7 enter confirm \u00B7 esc cancel'),
    h(Box, { marginBottom: 1 }),
    ...fields.map((field, i) => {
      const isActive = i === currentField;
      const hasError = triedSubmit && validationErrors[field.label];
      return h(FormField, {
        key: field.label,
        field,
        isActive,
        value: formValues[field.label] !== undefined ? formValues[field.label] : (field.value || ''),
        error: hasError,
      });
    }),
  );
}

export function renderInput({ title, fields, requiredFields }) {
  return new Promise((resolve) => {
    let resolved = false;
    const initialValues = {};
    fields.forEach(f => { initialValues[f.label] = f.value || ''; });

    const app = render(
      h(InputForm, {
        title,
        fields,
        values: initialValues,
        requiredFields: requiredFields || [],
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
          resolve(null);
        },
      })
    );
  });
}
