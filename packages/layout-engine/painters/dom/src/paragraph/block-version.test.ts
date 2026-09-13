import { describe, expect, it } from 'vitest';
import type { ParagraphBlock, StructuredContentMetadata } from '@superdoc/contracts';
import { deriveParagraphBlockVersion } from './block-version.js';

describe('deriveParagraphBlockVersion - structured content metadata (SD-3187)', () => {
  const paragraph = (scope: 'inline' | 'block', attrs: Partial<StructuredContentMetadata>): ParagraphBlock => {
    const sdt: StructuredContentMetadata = {
      type: 'structuredContent',
      scope,
      id: '2101',
      alias: 'Client',
      tag: 'client',
      ...attrs,
    };
    return {
      kind: 'paragraph',
      id: 'field-paragraph',
      attrs: scope === 'block' ? { sdt } : {},
      runs: [{ text: 'Unchanged content', fontFamily: 'Arial', fontSize: 16, ...(scope === 'inline' ? { sdt } : {}) }],
    };
  };
  const version = (block: ParagraphBlock) =>
    deriveParagraphBlockVersion(
      block,
      (sdt) => JSON.stringify(sdt) ?? '',
      () => '',
    );

  for (const scope of ['inline', 'block'] as const) {
    for (const property of ['alias', 'tag'] as const) {
      it(`invalidates ${scope} paint reuse when only ${property} changes`, () => {
        expect(version(paragraph(scope, { [property]: 'Updated' }))).not.toBe(version(paragraph(scope, {})));
      });
    }

    it(`keeps ${scope} paint reuse stable for equivalent metadata objects`, () => {
      expect(version(paragraph(scope, {}))).toBe(version(paragraph(scope, {})));
    });
  }
});

const makeParagraph = (color: string): ParagraphBlock => ({
  kind: 'paragraph',
  id: 'tracked-color',
  attrs: {},
  runs: [
    {
      text: 'Tracked',
      fontFamily: 'Arial',
      fontSize: 16,
      trackedChange: {
        kind: 'insert',
        id: 'tc-1',
        author: 'Alice',
        color,
      },
    },
  ],
});

const derive = (block: ParagraphBlock) =>
  deriveParagraphBlockVersion(
    block,
    () => '',
    () => '',
  );

describe('deriveParagraphBlockVersion - tracked-change colors', () => {
  it('changes when only the tracked-change author color changes', () => {
    const purple = derive(makeParagraph('#8250df'));
    const blue = derive(makeParagraph('#1f6feb'));

    expect(blue).not.toBe(purple);
  });

  it('is stable when the tracked-change author color is identical', () => {
    const a = derive(makeParagraph('#8250df'));
    const b = derive(makeParagraph('#8250df'));

    expect(a).toBe(b);
  });
});
