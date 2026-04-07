import { describe, it, expect, vi, beforeEach } from 'vitest';

const { TUI } = await import('../src/tui.js');

describe('TUI', () => {
  let master;
  let tui;

  beforeEach(() => {
    master = { _renderCallback: null };
    tui = new TUI(master);
  });

  it('constructor sets defaults', () => {
    expect(tui.running).toBe(false);
    expect(tui.renderTimer).toBeNull();
    expect(tui.inkApp).toBeNull();
  });

  it('start sets running to true (handles import error gracefully)', async () => {
    await tui.start();
    expect(tui.running).toBe(true);
  });

  it('stop clears running', () => {
    tui.running = true;
    tui.stop();
    expect(tui.running).toBe(false);
    expect(tui.inkApp).toBeNull();
    expect(tui.renderTimer).toBeNull();
  });

  it('stop unmounts ink app', () => {
    const unmount = vi.fn();
    tui.running = true;
    tui.inkApp = { unmount };
    tui.stop();
    expect(unmount).toHaveBeenCalled();
  });

  it('stop clears render timer', () => {
    vi.useFakeTimers();
    tui.running = true;
    tui.renderTimer = setTimeout(() => {}, 10000);
    tui.stop();
    expect(tui.renderTimer).toBeNull();
    vi.useRealTimers();
  });

  it('scheduleRender does nothing when not running', () => {
    tui.scheduleRender();
    expect(tui.renderTimer).toBeNull();
  });

  it('scheduleRender sets timer when running', () => {
    vi.useFakeTimers();
    tui.running = true;
    tui.scheduleRender();
    expect(tui.renderTimer).not.toBeNull();
    vi.useRealTimers();
  });

  it('scheduleRender debounces', () => {
    vi.useFakeTimers();
    tui.running = true;
    tui.scheduleRender();
    const timer1 = tui.renderTimer;
    tui.scheduleRender();
    expect(tui.renderTimer).toBe(timer1);
    vi.useRealTimers();
  });

  it('scheduleRender calls _renderCallback after 100ms', () => {
    vi.useFakeTimers();
    tui.running = true;
    master._renderCallback = vi.fn();
    tui.scheduleRender();
    expect(master._renderCallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(master._renderCallback).toHaveBeenCalled();
    expect(tui.renderTimer).toBeNull();
    vi.useRealTimers();
  });
});
