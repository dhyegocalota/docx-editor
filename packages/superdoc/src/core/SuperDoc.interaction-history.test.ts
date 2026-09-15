/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { SuperDoc } from './SuperDoc.js';

const instances: SuperDoc[] = [];
type Snapshot = {
  schemaVersion: number;
  sessionId: string;
  version: string;
  enabled: boolean;
  events: Array<{ sequence: number; type: string; data: Record<string, unknown> }>;
  retainedBytes: number;
  evictedEvents: number;
  truncatedEvents: number;
  captureFailures: number;
};
type Diagnostics = { getSnapshot(): Snapshot; clear(): void };
function create(history?: Record<string, unknown>) {
  const selector = document.createElement('div');
  document.body.append(selector);
  const instance = new SuperDoc({
    selector,
    telemetry: { enabled: false },
    ...(history ? { diagnostics: { history } } : {}),
  });
  instances.push(instance);
  return instance;
}
function diagnostics(instance: SuperDoc): Diagnostics {
  const handle = (instance as unknown as { diagnostics?: Diagnostics }).diagnostics;
  expect(handle, 'default-on Interaction History must be available without a ready document').toBeDefined();
  return handle!;
}
function exception(instance: SuperDoc, extra: Record<string, unknown> = {}) {
  instance.emit('exception', { error: new Error('private document text'), documentId: 'doc-a', ...extra } as never);
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
});

describe('SuperDoc Interaction History', () => {
  it('exports a serializable snapshot before any exception or worker exists', () => {
    const snapshot = diagnostics(create()).getSnapshot();
    expect(snapshot).toMatchObject({ schemaVersion: 1, enabled: true });
    expect(snapshot.sessionId).toEqual(expect.any(String));
    expect(snapshot.version).toEqual(expect.any(String));
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });

  it('records before exception listeners run without changing their payload', () => {
    const instance = create();
    const history = diagnostics(instance);
    history.clear();
    const payload = { error: new Error('secret'), documentId: 'doc-a' };
    const listener = vi.fn((received) => {
      expect(received).toBe(payload);
      expect(history.getSnapshot().events.at(-1)?.type).toBe('exception');
    });
    instance.on('exception', listener);
    instance.emit('exception', payload as never);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('evicts oldest events and does not retain editor or document content', () => {
    const instance = create({ maxEvents: 3 });
    const history = diagnostics(instance);
    history.clear();
    for (let i = 0; i < 8; i++) exception(instance, { editor: instance, message: 'private document text' });
    const snapshot = history.getSnapshot();
    expect(snapshot.events).toHaveLength(3);
    expect(snapshot.evictedEvents).toBe(5);
    expect(snapshot.events.map((event) => event.sequence)).toEqual(
      [...snapshot.events.map((event) => event.sequence)].sort((a, b) => a - b),
    );
    expect(JSON.stringify(snapshot)).not.toContain('private document text');
  });

  it('bounds bytes as well as event count and reports truncation', () => {
    const instance = create({ maxBytes: 2048, captureContent: true });
    const history = diagnostics(instance);
    history.clear();
    for (let i = 0; i < 100; i++) exception(instance, { message: 'x'.repeat(100_000) });
    const snapshot = history.getSnapshot();
    expect(snapshot.retainedBytes).toBeLessThanOrEqual(2048);
    expect(snapshot.truncatedEvents + snapshot.evictedEvents).toBeGreaterThan(0);
  });

  it('requires explicit content capture and returns independent snapshot copies', () => {
    const instance = create({ captureContent: true });
    const history = diagnostics(instance);
    exception(instance, { message: 'opted-in detail' });
    const snapshot = history.getSnapshot();
    expect(JSON.stringify(snapshot)).toContain('opted-in detail');
    snapshot.events.splice(0);
    expect(history.getSnapshot().events.length).toBeGreaterThan(0);
  });

  it('disables capture without disabling editor events or commands', () => {
    const instance = create({ enabled: false });
    const listener = vi.fn();
    instance.on('exception', listener);
    exception(instance);
    expect(instance.ui.commands.execute('unknown-command')).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(diagnostics(instance).getSnapshot()).toMatchObject({ enabled: false, events: [] });
  });

  it('records rejected command attempts even when no exception is raised', () => {
    const instance = create();
    const history = diagnostics(instance);
    history.clear();
    expect(instance.ui.commands.execute('unknown-command')).toBe(false);
    expect(history.getSnapshot().events.map((event) => event.type)).toEqual(['command:started', 'command:settled']);
    expect(history.getSnapshot().events[1].data).toMatchObject({ commandId: 'unknown-command', outcome: 'rejected' });
  });

  it('keeps independent sessions and records replacement without clearing the preceding evidence', () => {
    const first = create();
    const second = create();
    const history = diagnostics(first);
    history.clear();
    exception(first);
    first.emit('document-replaced', { editor: null } as never);
    expect(history.getSnapshot().events.map((event) => event.type)).toEqual(['exception', 'document-replaced']);
    expect(diagnostics(second).getSnapshot().sessionId).not.toBe(history.getSnapshot().sessionId);
  });

  it('isolates throwing payload getters and preserves original event delivery', () => {
    const instance = create();
    const history = diagnostics(instance);
    const listener = vi.fn();
    instance.on('exception', listener);
    const payload = {
      get documentId() {
        throw new Error('getter failed');
      },
      error: new Error('original'),
    };
    expect(() => instance.emit('exception', payload as never)).not.toThrow();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toBe(payload);
    expect(() => history.getSnapshot()).not.toThrow();
  });

  it('isolates failed serialization from editor callbacks and later capture', () => {
    const instance = create();
    const history = diagnostics(instance);
    const listener = vi.fn();
    instance.on('exception', listener);
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw new Error('serialization failure');
    });
    expect(() => exception(instance)).not.toThrow();
    expect(listener).toHaveBeenCalledOnce();
    expect(() => history.getSnapshot()).not.toThrow();
    stringify.mockRestore();
    exception(instance);
    expect(history.getSnapshot().events.at(-1)?.type).toBe('exception');
  });

  it('does not invoke payload toJSON or retain cyclic payloads', () => {
    const instance = create({ captureContent: true });
    const history = diagnostics(instance);
    const toJSON = vi.fn(() => {
      throw new Error('must not execute');
    });
    const payload: Record<string, unknown> = { toJSON, editor: instance };
    payload.self = payload;
    expect(() => exception(instance, payload)).not.toThrow();
    expect(toJSON).not.toHaveBeenCalled();
    expect(() => JSON.stringify(history.getSnapshot())).not.toThrow();
  });

  it('falls back safely for invalid limits and stops recording on destroy', () => {
    const instance = create({ maxEvents: -1, maxBytes: NaN });
    const history = diagnostics(instance);
    exception(instance);
    expect(history.getSnapshot().events.length).toBeGreaterThan(0);
    instance.destroy();
    const snapshot = history.getSnapshot();
    exception(instance);
    expect(history.getSnapshot()).toEqual(snapshot);
  });

  it('preserves exception and command behavior when snapshot export fails internally', () => {
    const instance = create();
    const history = diagnostics(instance);
    exception(instance);
    const parse = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw new Error('snapshot failure');
    });
    expect(() => history.getSnapshot()).not.toThrow();
    expect(instance.ui.commands.execute('unknown-command')).toBe(false);
    parse.mockRestore();
    expect(() => history.clear()).not.toThrow();
    expect(history.getSnapshot().events).toEqual([]);
  });
});
