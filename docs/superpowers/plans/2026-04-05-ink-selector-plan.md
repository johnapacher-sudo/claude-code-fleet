# Ink Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hand-rolled ANSI `selectFromList()` with an Ink card-style selector component.

**Architecture:** New `src/components/selector.mjs` ESM component renders card list with keyboard navigation. `src/index.js` rewrites `selectFromList` to dynamically import it. Three commands (run, model edit, model delete) adapt their data to the new item format.

**Tech Stack:** Ink 5, React 18, ESM .mjs component with CJS dynamic import bridge (same pattern as TUI dashboard).

---

## File Structure

```
src/
  components/
    selector.mjs    (NEW - Ink selector component)
    colors.mjs      (EXISTING - reuse color constants)
  index.js          (MODIFY - rewrite selectFromList + adapt callers)
```

---

### Task 1: Create `src/components/selector.mjs`

**Files:**
- Create: `src/components/selector.mjs`

This is the only new file. It exports `renderSelector(config)` which returns a Promise that resolves to the selected item's `value`.

```javascript
// src/components/selector.mjs
import React, { useState, useEffect } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { colors } from './colors.mjs';

const h = React.createElement;

function Selector({ title, items, dangerMode, onSelect, onCancel }) {
  const { exit } = useApp();
  const [selected, setSelected] = useState(0);

  const accentColor = dangerMode ? '#f85149' : colors.title;
  const accentColorDim = dangerMode ? '#525252' : '#1e1e1e';

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
      onSelect(items[selected]);
    }
  });

  return h(Box, { flexDirection: 'column' },
    // Title
    h(Text, { color: accentColor, bold: true }, `\u2B22 ${title}`),
    // Hints
    h(Text, { color: colors.idle, dimColor: true },
      '\u2191\u2193 navigate \u00B7 enter select \u00B7 q cancel'
    ),
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
        borderColor: isActive ? accentColor : 'transparent',
        paddingLeft: 1,
        marginBottom: 1,
      },
        // Row 1: label + detail
        h(Box, { justifyContent: 'space-between' },
          h(Box, { gap: 1 },
            isActive
              ? h(Text, { color: accentColor }, '\u276F')
              : h(Text, { color: 'transparent' }, ' '),
            h(Text, {
              color: isActive ? colors.projectName : colors.aiSummary,
              bold: isActive,
            }, item.label),
          ),
          h(Text, { color: colors.idle }, item.detail || ''),
        ),
        // Row 2: meta
        item.meta
          ? h(Text, { color: colors.idle, dimColor: true }, `  ${item.meta}`)
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
          const accentColor = dangerMode ? '#f85149' : colors.title;
          process.stdout.write(
            `\x1b[38;2;117;139;250m\u276F\x1b[0m ` +
            `\x1b[38;2;74;222;128m${item.label}\x1b[0m ` +
            `\x1b[38;2;82;82;82m${item.detail || ''}\x1b[0m\n`
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
```

### Task 2: Rewrite `selectFromList` in `src/index.js`

**Files:**
- Modify: `src/index.js`

Replace the `selectFromList` function (lines 190-258) with:

```javascript
async function selectFromList(items, label, dangerMode = false) {
  const { renderSelector } = await import(path.join(__dirname, 'components', 'selector.mjs'));
  return renderSelector({
    title: label,
    items: items.map(item => ({
      label: stripAnsi(item.display),
      detail: '',
      meta: '',
      value: item.value,
    })),
    dangerMode,
  });
}
```

Also add a `stripAnsi` helper near the top (after the ANSI object):

```javascript
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}
```

### Task 3: Adapt the three callers to pass richer data

**Files:**
- Modify: `src/index.js`

Instead of passing `display` with ANSI codes, pass structured data that the selector can render as cards.

**`cmdRun` (around line 389-394):** Change the items mapping:

```javascript
    const items = data.models.map(m => ({
      display: `${m.name} (${ANSI.cyan(m.model || 'default')})`,
      label: m.name,
      detail: m.model || 'default',
      meta: `key: ${m.apiKey ? m.apiKey.slice(0, 12) + '...' : 'not set'} \u00B7 endpoint: ${m.apiBaseUrl || 'default'}`,
      value: m.name,
    }));
```

**`cmdModelEdit` (around line 315-318):** Same pattern:

```javascript
  const items = data.models.map(m => ({
    display: `${m.name} (${m.model || 'default'})`,
    label: m.name,
    detail: m.model || 'default',
    meta: `key: ${m.apiKey ? m.apiKey.slice(0, 12) + '...' : 'not set'} \u00B7 endpoint: ${m.apiBaseUrl || 'default'}`,
    value: m.name,
  }));
```

**`cmdModelDelete` (around line 351-354):** Same + dangerMode:

```javascript
  const items = data.models.map(m => ({
    display: `${m.name} (${m.model || 'default'})`,
    label: m.name,
    detail: m.model || 'default',
    meta: `key: ${m.apiKey ? m.apiKey.slice(0, 12) + '...' : 'not set'} \u00B7 endpoint: ${m.apiBaseUrl || 'default'}`,
    value: m.name,
  }));
```

And the selectFromList call for delete:

```javascript
  const selected = await selectFromList(items, 'Select a model to delete', true);
```

### Task 4: Update `selectFromList` to use new fields

Update the `selectFromList` function to pass the new fields through:

```javascript
async function selectFromList(items, label, dangerMode = false) {
  const { renderSelector } = await import(path.join(__dirname, 'components', 'selector.mjs'));
  return renderSelector({
    title: label,
    items: items.map(item => ({
      label: item.label || stripAnsi(item.display),
      detail: item.detail || '',
      meta: item.meta || '',
      value: item.value,
    })),
    dangerMode,
  });
}
```

### Task 5: Verify and commit

```bash
# Verify selector component loads
node --input-type=module -e "import { renderSelector } from './src/components/selector.mjs'; console.log('ok:', typeof renderSelector)"

# Verify index.js loads
node -e "require('./src/index.js')" 2>&1 || echo "expected: shows help or runs command"

# Commit
git add src/components/selector.mjs src/index.js
git commit -m "feat: replace ANSI selector with Ink card-style selector component"
```
