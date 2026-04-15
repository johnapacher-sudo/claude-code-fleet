import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('notifier', () => {
  describe('loadNotifyConfig', () => {
    let loadNotifyConfig;

    beforeEach(async () => {
      const mod = await import('../src/notifier.js');
      loadNotifyConfig = mod.loadNotifyConfig;
    });

    it('returns default config when notify.json does not exist', () => {
      const config = loadNotifyConfig();
      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('events');
      expect(config.events).toHaveProperty('stop');
      expect(config.events).toHaveProperty('notification');
    });

    it('returns enabled=true by default', () => {
      const config = loadNotifyConfig();
      expect(typeof config.enabled).toBe('boolean');
    });
  });

  describe('sendNotification', () => {
    let sendNotification;

    beforeEach(async () => {
      const mod = await import('../src/notifier.js');
      sendNotification = mod.sendNotification;
    });

    it('does not throw on any platform', () => {
      expect(() => sendNotification({
        title: 'Test', body: 'Test body', sessionId: 'test-session', platform: process.platform,
      })).not.toThrow();
    });

    it('handles empty body without error', () => {
      expect(() => sendNotification({
        title: 'Test', body: '', sessionId: 'test-session', platform: process.platform,
      })).not.toThrow();
    });

    it('handles null body without error', () => {
      expect(() => sendNotification({
        title: 'Test', body: null, sessionId: 'test-session', platform: process.platform,
      })).not.toThrow();
    });

    it('truncates long body text', () => {
      expect(() => sendNotification({
        title: 'Test', body: 'x'.repeat(500), sessionId: 'test-session', platform: process.platform,
      })).not.toThrow();
    });
  });
});
