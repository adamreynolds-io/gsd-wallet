import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.useFakeTimers();

const mockStorage = {
  set: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue({}),
};
vi.stubGlobal('chrome', { storage: { local: mockStorage } });

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++uuidCounter}`,
});

async function freshImport() {
  vi.resetModules();
  uuidCounter = 0;
  return await import('./diagnosticLogger');
}

describe('diagnosticLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.get.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('emit', () => {
    it('creates events with incrementing IDs', async () => {
      const mod = await freshImport();
      mod.emit('info', 'sw', 'first');
      mod.emit('warn', 'wallet', 'second');

      const backlog = mod.getBacklog();
      expect(backlog).toHaveLength(2);
      expect(backlog[0]!.id).toBe(1);
      expect(backlog[1]!.id).toBe(2);
    });

    it('pushes events to buffer', async () => {
      const mod = await freshImport();
      mod.emit('info', 'sw', 'test message', { key: 'val' });

      const backlog = mod.getBacklog();
      expect(backlog).toHaveLength(1);
      expect(backlog[0]).toMatchObject({
        level: 'info',
        category: 'sw',
        message: 'test message',
        data: { key: 'val' },
      });
    });

    it('includes elapsed when provided', async () => {
      const mod = await freshImport();
      mod.emit('debug', 'sync', 'timed op', undefined, 42);

      const backlog = mod.getBacklog();
      expect(backlog[0]!.elapsed).toBe(42);
      expect(backlog[0]).not.toHaveProperty('data');
    });
  });

  describe('buffer overflow', () => {
    it('trims oldest events when exceeding 2000', async () => {
      const mod = await freshImport();
      for (let i = 0; i < 2010; i++) {
        mod.emit('info', 'sw', `event ${i}`);
      }

      const backlog = mod.getBacklog();
      expect(backlog).toHaveLength(2000);
      expect(backlog[0]!.id).toBe(11);
      expect(backlog[backlog.length - 1]!.id).toBe(2010);
    });
  });

  describe('flush timing', () => {
    it('delays flush 100ms when < 3 events', async () => {
      const mod = await freshImport();
      mod.emit('info', 'sw', 'one');
      mod.emit('info', 'sw', 'two');

      expect(mockStorage.set).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(mockStorage.set).toHaveBeenCalledTimes(1);
    });

    it('flushes immediately when >= 3 events', async () => {
      const mod = await freshImport();
      mod.emit('info', 'sw', 'one');
      mod.emit('info', 'sw', 'two');
      mod.emit('info', 'sw', 'three');

      expect(mockStorage.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('flush', () => {
    it('calls chrome.storage.local.set with buffer', async () => {
      const mod = await freshImport();
      mod.emit('info', 'sw', 'hello');
      vi.advanceTimersByTime(100);

      expect(mockStorage.set).toHaveBeenCalledWith({
        gsdDiagnosticEvents: expect.arrayContaining([
          expect.objectContaining({ message: 'hello' }),
        ]),
      });
    });
  });

  describe('onEvent', () => {
    it('listener called on each emit', async () => {
      const mod = await freshImport();
      const listener = vi.fn();
      mod.onEvent(listener);

      mod.emit('info', 'sw', 'a');
      mod.emit('warn', 'wallet', 'b');

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'a' }),
      );
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'b' }),
      );
    });

    it('unsubscribed listener no longer called', async () => {
      const mod = await freshImport();
      const listener = vi.fn();
      const unsub = mod.onEvent(listener);

      mod.emit('info', 'sw', 'before');
      unsub();
      mod.emit('info', 'sw', 'after');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'before' }),
      );
    });

    it('listener error does not break subsequent emissions', async () => {
      const mod = await freshImport();
      const badListener = vi.fn(() => {
        throw new Error('boom');
      });
      const goodListener = vi.fn();
      mod.onEvent(badListener);
      mod.onEvent(goodListener);

      mod.emit('info', 'sw', 'test');

      expect(badListener).toHaveBeenCalledTimes(1);
      expect(goodListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('rehydrate', () => {
    it('loads events from storage and sets nextId', async () => {
      const stored = [
        { id: 50, timestamp: 1000, level: 'info', category: 'sw', message: 'old' },
        { id: 51, timestamp: 1001, level: 'info', category: 'sw', message: 'older' },
      ];
      mockStorage.get.mockResolvedValue({
        gsdDiagnosticEvents: stored,
      });

      const mod = await freshImport();
      await mod.rehydrate();

      const backlog = mod.getBacklog();
      expect(backlog).toHaveLength(2);
      expect(backlog[0]!.id).toBe(50);

      // Next emitted event should have id 52
      mod.emit('info', 'sw', 'new');
      const all = mod.getBacklog();
      expect(all[all.length - 1]!.id).toBe(52);
    });
  });

  describe('getBacklog', () => {
    it('returns a copy of the buffer', async () => {
      const mod = await freshImport();
      mod.emit('info', 'sw', 'x');

      const copy1 = mod.getBacklog();
      const copy2 = mod.getBacklog();
      expect(copy1).toEqual(copy2);
      expect(copy1).not.toBe(copy2);
    });
  });
});
