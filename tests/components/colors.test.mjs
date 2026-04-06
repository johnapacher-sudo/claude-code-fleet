import { colors } from '../../src/components/colors.mjs';
import { describe, it, expect } from 'vitest';

describe('colors', () => {
  it('exports all color constants', () => {
    const expected = {
      title: '#a78bfa', running: '#4ade80', idle: '#525252',
      slow: '#fbbf24', alert: '#ef4444', projectName: '#e0e0e0',
      modelAlias: '#a78bfa', modelName: '#525252', aiSummary: '#8b949e',
      toolName: '#d4d4d4', target: '#8b949e', doneMark: '#4ade80',
      border: '#3a3a3a', separator: '#2a2a2a', footer: '#444444',
    };
    expect(colors).toEqual(expected);
  });
});
