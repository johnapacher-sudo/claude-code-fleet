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
});
