/** @vitest-environment jsdom */
import { describe, expect, it, vi, afterEach } from 'vite-plus/test';
import { createInteractionHistory, recordInteraction, closeInteractionHistory } from './interaction-history.js';

afterEach(() => vi.restoreAllMocks());
function fixture(history = {}) {
  const owner = {};
  const root = document.createElement('div');
  const api = createInteractionHistory(owner, { diagnostics: { history } }, () => 'test-version', root);
  api.clear();
  return { owner, root, api };
}
describe('InteractionRecorder', () => {
  it.each(['insertText', 'insertFromPaste', 'insertCompositionText', 'deleteContentBackward'])(
    'captures %s without retaining input text',
    (inputType) => {
      const { owner, root, api } = fixture();
      root.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          inputType,
          data: 'secret',
          isComposing: inputType === 'insertCompositionText',
        }),
      );
      expect(api.getSnapshot().events[0]).toMatchObject({
        type: 'input:beforeinput',
        data: { inputType, dataLength: 6 },
      });
      expect(JSON.stringify(api.getSnapshot())).not.toContain('secret');
      closeInteractionHistory(owner);
      root.dispatchEvent(new InputEvent('beforeinput', { inputType }));
      expect(api.getSnapshot().events).toHaveLength(1);
    },
  );
  it('retains receipt IDs, remote provenance, undo/redo and render completion with no document reads', () => {
    const { owner, api } = fixture();
    for (const event of [
      { type: 'mutation:committed', receipt: { txId: 'tx-1', success: true } },
      { type: 'mutation:committed', origin: 'history', direction: 'undo' },
      { type: 'mutation:committed', origin: 'history', direction: 'redo' },
      { type: 'collaboration:remote-changed', remoteGeneration: 2 },
      { type: 'render:complete', snapshot: { commitSequence: 3 } },
    ])
      recordInteraction(owner, event.type, () => event);
    expect(api.getSnapshot().events).toHaveLength(5);
    expect(api.getSnapshot().events[0].data.receipt).toMatchObject({ txId: 'tx-1' });
  });
  it('never evaluates capture data when disabled', () => {
    const { owner, api } = fixture({ enabled: false });
    const read = vi.fn(() => {
      throw new Error('must not read');
    });
    recordInteraction(owner, 'mutation:committed', read);
    expect(read).not.toHaveBeenCalled();
    expect(api.getSnapshot().events).toEqual([]);
  });
  it('isolates payload projection, clock, lookup, allocation and teardown failures', () => {
    const { owner, api } = fixture();
    const broken = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('projection failed');
        },
      },
    );
    expect(() => recordInteraction(owner, 'mutation:committed', () => broken)).not.toThrow();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('clock failed');
    });
    expect(() => recordInteraction(owner, 'mutation:committed', () => ({}))).not.toThrow();
    clock.mockRestore();
    const get = WeakMap.prototype.get;
    let lookupThrew = false;
    try {
      WeakMap.prototype.get = () => {
        throw new Error('lookup failed');
      };
      recordInteraction(owner, 'mutation:committed', () => ({}));
    } catch {
      lookupThrew = true;
    } finally {
      WeakMap.prototype.get = get;
    }
    expect(lookupThrew).toBe(false);
    const push = Array.prototype.push;
    let threw = false;
    try {
      Array.prototype.push = () => {
        throw new Error('allocation failed');
      };
      api.getSnapshot();
    } catch {
      threw = true;
    } finally {
      Array.prototype.push = push;
    }
    expect(threw).toBe(false);
    const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener').mockImplementation(() => {
      throw new Error('detach failed');
    });
    expect(() => closeInteractionHistory(owner)).not.toThrow();
    remove.mockRestore();
    expect(api.getSnapshot().captureFailures).toBeGreaterThan(0);
  });
  it('bounds large/cyclic structures before serialization and never invokes getters or toJSON', () => {
    const { owner, api } = fixture({ captureContent: true });
    const getter = vi.fn(() => {
      throw new Error('getter');
    });
    const value: Record<string, unknown> = { text: 'x'.repeat(100000), inserted: Array(100000).fill({ id: 'node' }) };
    value.receipt = value;
    Object.defineProperty(value, 'message', { get: getter });
    value.toJSON = getter;
    recordInteraction(owner, 'mutation:committed', () => value);
    expect(getter).not.toHaveBeenCalled();
    expect(api.getSnapshot().retainedBytes).toBeLessThanOrEqual(8192);
    expect(api.getSnapshot().truncatedEvents).toBe(1);
  });
  it('coalesces consecutive identical selections but preserves each edit', () => {
    const { owner, api } = fixture();
    const event = { selection: { blockId: 'p1', offset: 2 } };
    recordInteraction(owner, 'selection:changed', () => event);
    recordInteraction(owner, 'selection:changed', () => event);
    recordInteraction(owner, 'mutation:committed', () => ({ receipt: { txId: 'tx-1' } }));
    recordInteraction(owner, 'mutation:committed', () => ({ receipt: { txId: 'tx-2' } }));
    expect(api.getSnapshot().events).toHaveLength(3);
  });
  it('stays bounded through a long editing session', () => {
    const { owner, api } = fixture();
    for (let i = 0; i < 10000; i++)
      recordInteraction(owner, 'mutation:committed', () => ({ receipt: { txId: `tx-${i}` } }));
    const snapshot = api.getSnapshot();
    expect(snapshot.events).toHaveLength(500);
    expect(snapshot.evictedEvents).toBe(9500);
    expect(snapshot.retainedBytes).toBeLessThanOrEqual(1_048_576);
  });
});

it('captures intercepted keyboard attempts without retaining literal keys', () => {
  const { root, api } = fixture();
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'X', bubbles: true }));
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  expect(api.getSnapshot().events.map((event) => event.data.inputKind)).toEqual(['key', 'Backspace']);
  expect(JSON.stringify(api.getSnapshot())).not.toContain('"X"');
});
