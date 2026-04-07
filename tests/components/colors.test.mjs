import { colors } from '../../src/components/colors.mjs';
import { describe, it, expect } from 'vitest';

describe('colors', () => {
  it('exports all color constants', () => {
    const expected = {
      title: '#a78bfa',
      running: '#4ade80',
      idle: '#525252',
      slow: '#fbbf24',
      projectName: '#e0e0e0',
      modelAlias: '#a78bfa',
      modelName: '#525252',
      aiSummary: '#8b949e',
      toolName: '#d4d4d4',
      target: '#8b949e',
      doneMark: '#4ade80',
      spinnerColor: '#fbbf24',
      activeLine: '#4ade80',
      historyLine: '#525252',
      separator: '#1e1e1e',
      footer: '#333333',
    };
    expect(colors).toEqual(expected);
  });
});
