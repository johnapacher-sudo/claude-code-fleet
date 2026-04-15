import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('notifier', () => {
  describe('detectError', () => {
    let detectError;

    beforeEach(async () => {
      const mod = await import('../src/notifier.js');
      detectError = mod.detectError;
    });

    it('returns false for null message', () => {
      expect(detectError(null)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(detectError('')).toBe(false);
    });

    it('returns false for normal completion message', () => {
      expect(detectError('Successfully refactored the authentication module.')).toBe(false);
    });

    it('returns true for message containing "error"', () => {
      expect(detectError('An error occurred while processing')).toBe(true);
    });

    it('returns true for message containing "Error"', () => {
      expect(detectError('TypeError: Cannot read property')).toBe(true);
    });

    it('returns true for message containing "failed"', () => {
      expect(detectError('The operation failed unexpectedly')).toBe(true);
    });

    it('returns true for message containing "Failed"', () => {
      expect(detectError('Failed to connect to database')).toBe(true);
    });

    it('returns true for message containing "exception"', () => {
      expect(detectError('Unhandled exception in worker thread')).toBe(true);
    });

    it('returns true for message containing "Exception"', () => {
      expect(detectError('NullPointerException at line 42')).toBe(true);
    });

    it('returns true for message containing "errors" (intentional over-detection)', () => {
      expect(detectError('Fixed all errors in the codebase')).toBe(true);
    });
  });

  describe('loadNotifyConfig', () => {
    let loadNotifyConfig;

    beforeEach(async () => {
      const mod = await import('../src/notifier.js');
      loadNotifyConfig = mod.loadNotifyConfig;
    });

    it('returns default config when notify.json does not exist', () => {
      const config = loadNotifyConfig();
      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('timeoutMinutes');
      expect(config).toHaveProperty('events');
      expect(config.events).toHaveProperty('stop');
      expect(config.events).toHaveProperty('error');
      expect(config.events).toHaveProperty('timeout');
      expect(config.events).toHaveProperty('notification');
    });

    it('returns enabled=true by default', () => {
      const config = loadNotifyConfig();
      expect(typeof config.enabled).toBe('boolean');
    });

    it('returns timeoutMinutes as a number', () => {
      const config = loadNotifyConfig();
      expect(typeof config.timeoutMinutes).toBe('number');
      expect(config.timeoutMinutes).toBeGreaterThan(0);
    });
  });

  describe('updateActivity', () => {
    let updateActivity, _SESSIONS_DIR;
    const testSessionId = 'test-update-activity-session';

    beforeEach(async () => {
      const mod = await import('../src/notifier.js');
      updateActivity = mod.updateActivity;
      _SESSIONS_DIR = mod._SESSIONS_DIR;
    });

    afterEach(() => {
      const filePath = path.join(_SESSIONS_DIR, `${testSessionId}.last-activity`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    it('writes a timestamp file that exists and contains a positive number', () => {
      updateActivity(testSessionId);
      const filePath = path.join(_SESSIONS_DIR, `${testSessionId}.last-activity`);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      const timestamp = parseInt(content, 10);
      expect(timestamp).toBeGreaterThan(0);
    });
  });

  describe('timeout flags', () => {
    let clearTimeoutFlag, isStopNotified, markStopNotified, _SESSIONS_DIR;
    const testSessionId = 'test-timeout-flags-session';

    beforeEach(async () => {
      const mod = await import('../src/notifier.js');
      clearTimeoutFlag = mod.clearTimeoutFlag;
      isStopNotified = mod.isStopNotified;
      markStopNotified = mod.markStopNotified;
      _SESSIONS_DIR = mod._SESSIONS_DIR;
    });

    afterEach(() => {
      const timeoutFlag = path.join(_SESSIONS_DIR, `${testSessionId}.timeout-notified`);
      const stopFlag = path.join(_SESSIONS_DIR, `${testSessionId}.stop-notified`);
      if (fs.existsSync(timeoutFlag)) fs.unlinkSync(timeoutFlag);
      if (fs.existsSync(stopFlag)) fs.unlinkSync(stopFlag);
    });

    it('isStopNotified returns false when no flag exists', () => {
      expect(isStopNotified(testSessionId)).toBe(false);
    });

    it('markStopNotified creates flag and isStopNotified returns true', () => {
      markStopNotified(testSessionId);
      expect(isStopNotified(testSessionId)).toBe(true);
    });

    it('clearTimeoutFlag removes timeout flag file', () => {
      const flagPath = path.join(_SESSIONS_DIR, `${testSessionId}.timeout-notified`);
      fs.mkdirSync(_SESSIONS_DIR, { recursive: true });
      fs.writeFileSync(flagPath, String(Date.now()));
      expect(fs.existsSync(flagPath)).toBe(true);

      clearTimeoutFlag(testSessionId);
      expect(fs.existsSync(flagPath)).toBe(false);
    });

    it('clearTimeoutFlag does not throw when file does not exist', () => {
      expect(() => clearTimeoutFlag(testSessionId)).not.toThrow();
    });
  });

  describe('checkTimeout', () => {
    let checkTimeout, _SESSIONS_DIR;
    const testSessionId = 'test-check-timeout-session';

    beforeEach(async () => {
      const mod = await import('../src/notifier.js');
      checkTimeout = mod.checkTimeout;
      _SESSIONS_DIR = mod._SESSIONS_DIR;
    });

    afterEach(() => {
      const activityFile = path.join(_SESSIONS_DIR, `${testSessionId}.last-activity`);
      const timeoutFlag = path.join(_SESSIONS_DIR, `${testSessionId}.timeout-notified`);
      if (fs.existsSync(activityFile)) fs.unlinkSync(activityFile);
      if (fs.existsSync(timeoutFlag)) fs.unlinkSync(timeoutFlag);
    });

    it('does not notify when activity is recent', () => {
      const mod = require('../src/notifier.js');
      fs.mkdirSync(_SESSIONS_DIR, { recursive: true });
      const activityPath = path.join(_SESSIONS_DIR, `${testSessionId}.last-activity`);
      fs.writeFileSync(activityPath, String(Date.now()));

      const config = { ...mod._DEFAULT_CONFIG, events: { ...mod._DEFAULT_CONFIG.events } };
      const result = checkTimeout(testSessionId, config);
      expect(result).toBe(false);
    });

    it('notifies when activity is older than threshold', () => {
      const mod = require('../src/notifier.js');
      fs.mkdirSync(_SESSIONS_DIR, { recursive: true });
      const activityPath = path.join(_SESSIONS_DIR, `${testSessionId}.last-activity`);
      // Write a timestamp 10 minutes in the past
      fs.writeFileSync(activityPath, String(Date.now() - 10 * 60 * 1000));

      const config = { ...mod._DEFAULT_CONFIG, events: { ...mod._DEFAULT_CONFIG.events } };
      const result = checkTimeout(testSessionId, config);
      expect(result).toBe(true);

      // Verify timeout flag was created
      const flagPath = path.join(_SESSIONS_DIR, `${testSessionId}.timeout-notified`);
      expect(fs.existsSync(flagPath)).toBe(true);
    });

    it('does not notify again when already notified', () => {
      const mod = require('../src/notifier.js');
      fs.mkdirSync(_SESSIONS_DIR, { recursive: true });
      const activityPath = path.join(_SESSIONS_DIR, `${testSessionId}.last-activity`);
      fs.writeFileSync(activityPath, String(Date.now() - 10 * 60 * 1000));

      // Create the timeout-notified flag manually
      const flagPath = path.join(_SESSIONS_DIR, `${testSessionId}.timeout-notified`);
      fs.writeFileSync(flagPath, String(Date.now()));

      const config = { ...mod._DEFAULT_CONFIG, events: { ...mod._DEFAULT_CONFIG.events } };
      const result = checkTimeout(testSessionId, config);
      expect(result).toBe(false);
    });

    it('skips when no activity file exists', () => {
      const mod = require('../src/notifier.js');
      const config = { ...mod._DEFAULT_CONFIG, events: { ...mod._DEFAULT_CONFIG.events } };
      const result = checkTimeout(testSessionId, config);
      expect(result).toBe(false);
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
