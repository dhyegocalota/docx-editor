import { describe, expect, it } from 'vitest';
import { applyUpdate, Doc as YDoc } from 'yjs';
import JSZip from 'jszip';
import { Awareness } from 'y-protocols/awareness.js';
import { Editor } from '@core/Editor.js';
import { getTestDataAsFileBuffer } from '@tests/helpers/helpers.js';

// Synthetic package with four embedding variants and distinct opaque byte payloads.
// These sentinel bytes test package preservation, not font rendering. No customer data.
const FIXTURE = 'sd-4983-embedded-fonts.docx';
const RELS = 'word/_rels/fontTable.xml.rels';

async function assertFontsPreserved(bytes, source) {
  const actual = await JSZip.loadAsync(bytes);
  const expected = await JSZip.loadAsync(source);
  for (const path of Object.keys(expected.files).filter((p) => p.endsWith('.odttf'))) {
    expect(actual.file(path), `missing embedded font part: ${path}`).not.toBeNull();
    expect(await actual.file(path).async('uint8array')).toEqual(await expected.file(path).async('uint8array'));
  }
  expect(actual.file(RELS), 'missing font relationships').not.toBeNull();
  const rels = await actual.file(RELS).async('string');
  for (const rel of (await expected.file(RELS).async('string')).match(/<Relationship\s[^>]+/g)) {
    for (const attr of rel.match(/(?:Id|Type|Target)="[^"]+"/g)) expect(rels).toContain(attr);
  }
  const fontTable = await actual.file('word/fontTable.xml').async('string');
  for (const embed of (await expected.file('word/fontTable.xml').async('string')).match(/<w:embed[^>]+/g)) {
    for (const attr of embed.match(/(?:r:id|w:fontKey)="[^"]+"/g)) expect(fontTable).toContain(attr);
  }
}

async function joinRoom(mutate = () => {}) {
  const source = await getTestDataAsFileBuffer(FIXTURE);
  const seed = await Editor.open(source, { isHeadless: true });
  const ydoc = new YDoc();
  try {
    applyUpdate(ydoc, await seed.generateCollaborationUpdate());
  } finally {
    seed.destroy();
  }
  expect(Object.keys(ydoc.getMap('meta').get('fonts'))).toHaveLength(4);
  expect(ydoc.getMap('parts').has(RELS)).toBe(true);
  expect(ydoc.getXmlFragment('supereditor').toString()).toContain('Embedded font room export');
  mutate(ydoc);
  const editor = await Editor.open(undefined, {
    isHeadless: true,
    ydoc,
    collaborationProvider: { synced: true, awareness: new Awareness(ydoc), on() {}, off() {} },
    fragment: ydoc.getXmlFragment('supereditor'),
    isNewFile: false,
  });
  expect(editor.state.doc.textContent).toContain('Embedded font room export');
  return { editor, ydoc, source };
}

describe('SD-4983 embedded fonts in DOCX export', () => {
  it('preserves standalone font bytes, relationships, and keys', async () => {
    const source = await getTestDataAsFileBuffer(FIXTURE);
    const editor = await Editor.open(source, { isHeadless: true });
    try {
      await assertFontsPreserved(await editor.exportDocx({ isFinalDoc: false, commentsType: 'clean' }), source);
    } finally {
      editor.destroy();
    }
  });

  it('preserves fonts from a complete server seed without a source file at join', async () => {
    const { editor, ydoc, source } = await joinRoom();
    try {
      await assertFontsPreserved(await editor.exportDocx({ isFinalDoc: false, commentsType: 'clean' }), source);
    } finally {
      editor.destroy();
      ydoc.destroy();
    }
  });

  for (const [label, mutate] of [
    [
      'missing font binary',
      (doc) => {
        const fonts = { ...doc.getMap('meta').get('fonts') };
        delete fonts['word/fonts/font0.odttf'];
        doc.getMap('meta').set('fonts', fonts);
      },
    ],
    ['missing font metadata', (doc) => doc.getMap('meta').delete('fonts')],
    ['missing font relationships', (doc) => doc.getMap('parts').delete(RELS)],
  ]) {
    it(`explicitly rejects ${label} without deleting embedding declarations`, async () => {
      const { editor, ydoc } = await joinRoom(mutate);
      try {
        const before = JSON.stringify(editor.converter.convertedXml['word/fontTable.xml']);
        await expect(
          editor.exportDocx({ isFinalDoc: false, commentsType: 'clean' }).then(() => 'export succeeded'),
        ).rejects.toThrow(/embedded font/i);
        expect(JSON.stringify(editor.converter.convertedXml['word/fontTable.xml'])).toBe(before);
      } finally {
        editor.destroy();
        ydoc.destroy();
      }
    });
  }

  it('uses current room font assets after a join and can retry a failed export', async () => {
    const { editor, ydoc, source } = await joinRoom();
    try {
      const fonts = ydoc.getMap('meta').get('fonts');
      await assertFontsPreserved(await editor.exportDocx(), source);
      ydoc.getMap('meta').set('fonts', {});
      await expect(editor.exportDocx().then(() => 'export succeeded')).rejects.toThrow(/embedded font/i);
      ydoc.getMap('meta').set('fonts', fonts);
      await assertFontsPreserved(await editor.exportDocx(), source);
    } finally {
      editor.destroy();
      ydoc.destroy();
    }
  });

  it('still exports a room with no embedded fonts', async () => {
    const seed = await Editor.open(undefined, { isHeadless: true });
    const ydoc = new YDoc();
    let editor;
    try {
      applyUpdate(ydoc, await seed.generateCollaborationUpdate());
      editor = await Editor.open(undefined, { isHeadless: true, ydoc, isNewFile: false });
      const zip = await JSZip.loadAsync(await editor.exportDocx());
      expect(zip.file('word/document.xml')).not.toBeNull();
    } finally {
      editor?.destroy();
      seed.destroy();
      ydoc.destroy();
    }
  });
});

// Validate the final package even when a source file is available. Importing an
// incomplete document must not make a later successful export look trustworthy.
describe('SD-4983 incomplete embedded-font packages', () => {
  for (const [label, mutate] of [
    ['missing binary', async (zip) => zip.remove('word/fonts/font0.odttf')],
    [
      'missing relationship ID',
      async (zip) => {
        zip.file(
          'word/fontTable.xml',
          (await zip.file('word/fontTable.xml').async('string')).replace('r:id="rFont0"', ''),
        );
      },
    ],
    [
      'unknown relationship ID',
      async (zip) => {
        zip.file(
          'word/fontTable.xml',
          (await zip.file('word/fontTable.xml').async('string')).replace('r:id="rFont0"', 'r:id="unknown"'),
        );
      },
    ],
    [
      'external font relationship',
      async (zip) => {
        zip.file(
          RELS,
          (await zip.file(RELS).async('string')).replace('Id="rFont0"', 'Id="rFont0" TargetMode="External"'),
        );
      },
    ],
    [
      'wrong relationship type',
      async (zip) => {
        zip.file(RELS, (await zip.file(RELS).async('string')).replace('/relationships/font"', '/relationships/image"'));
      },
    ],
  ]) {
    it(`rejects ${label} on standalone export`, async () => {
      const zip = await JSZip.loadAsync(await getTestDataAsFileBuffer(FIXTURE));
      await mutate(zip);
      const source = await zip.generateAsync({ type: 'nodebuffer' });
      const editor = await Editor.open(source, { isHeadless: true });
      try {
        await expect(editor.exportDocx().then(() => 'export succeeded')).rejects.toThrow(/embedded font/i);
      } finally {
        editor.destroy();
      }
    });
  }

  for (const target of ['/word/fonts/font0.odttf', './fonts/font0.odttf']) {
    it(`preserves valid relationship target ${target}`, async () => {
      const zip = await JSZip.loadAsync(await getTestDataAsFileBuffer(FIXTURE));
      zip.file(
        RELS,
        (await zip.file(RELS).async('string')).replace('Target="fonts/font0.odttf"', `Target="${target}"`),
      );
      const source = await zip.generateAsync({ type: 'nodebuffer' });
      const editor = await Editor.open(source, { isHeadless: true });
      try {
        await assertFontsPreserved(await editor.exportDocx(), source);
      } finally {
        editor.destroy();
      }
    });
  }
});
