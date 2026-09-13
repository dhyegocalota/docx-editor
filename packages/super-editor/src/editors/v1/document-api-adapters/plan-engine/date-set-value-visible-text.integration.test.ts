/* @vitest-environment jsdom */

/**
 * End-to-end coverage for `date.setValue`: it must update the SDT's VISIBLE
 * text, not just the stored `w:fullDate` value.
 *
 * Writing `w:sdtPr/w:date/@w:fullDate` alone leaves the rendered content
 * untouched, so a date control keeps showing its placeholder
 * ("Click or tap to enter a date.") even though the OOXML value is correct.
 * The unit test in `content-controls-wrappers.test.ts` pins the wrapper-level
 * behavior with a mock; this test drives the real import → mutate → read
 * pipeline against the `date_control.docx` fixture to confirm the behavior
 * holds end-to-end and to guard against regressions.
 */

import { describe, expect, it } from 'vitest';
import { initTestEditor, loadTestDataForEditorTests } from '@tests/helpers/helpers.js';

const PLACEHOLDER = 'Click or tap to enter a date.';
const NEW_DATE = '2026-05-24';
// date_control.docx carries w:dateFormat = dd/MM/yyyy (lid en-GB).
const MASKED_DATE = '24/05/2026';

function loadDateEditor(docData: Awaited<ReturnType<typeof loadTestDataForEditorTests>>) {
  const { editor } = initTestEditor({
    content: docData.docx,
    media: docData.media,
    mediaFiles: docData.mediaFiles,
    fonts: docData.fonts,
    isHeadless: true,
    user: { name: 'Test', email: 'test@example.com' },
  });
  return editor;
}

describe('date.setValue updates visible text', () => {
  it('replaces the placeholder with the new value in the rendered date control', async () => {
    const docData = await loadTestDataForEditorTests('date_control.docx');
    const { editor } = initTestEditor({
      content: docData.docx,
      media: docData.media,
      mediaFiles: docData.mediaFiles,
      fonts: docData.fonts,
      isHeadless: true,
      user: { name: 'Test', email: 'test@example.com' },
    });

    // Sanity check: the fixture starts out showing Word's date placeholder.
    const before = await Promise.resolve(editor.doc.contentControls.list());
    const dateBefore = before.items.find((item) => item.controlType === 'date');
    expect(dateBefore).toBeDefined();
    expect(dateBefore?.text).toContain(PLACEHOLDER);

    const result = await Promise.resolve(
      editor.doc.contentControls.date.setValue(
        { target: dateBefore!.target, value: NEW_DATE },
        { changeMode: 'direct' },
      ),
    );
    expect(result.success).toBe(true);

    // Re-read: the visible text should now be the date rendered through the
    // control's w:dateFormat mask (dd/MM/yyyy), not the placeholder.
    const after = await Promise.resolve(editor.doc.contentControls.list());
    const dateAfter = after.items.find((item) => item.controlType === 'date');
    expect(dateAfter?.text).toContain(MASKED_DATE);
    expect(dateAfter?.text).not.toContain(PLACEHOLDER);
  });
});

// SD-3802 defect coverage against the real import -> mutate -> read pipeline.
describe('SD-3802: date.setValue OOXML correctness (end-to-end)', () => {
  // (a) w:showingPlcHdr declares that the control still shows placeholder text.
  // Once a real value is set, it must be removed from sdtPr, otherwise a
  // reopening Word treats the stored value as placeholder and re-hides it.
  it('removes w:showingPlcHdr from sdtPr after setting a real value', async () => {
    const docData = await loadTestDataForEditorTests('date_control.docx');
    const editor = loadDateEditor(docData);

    const before = editor.doc.contentControls.list();
    const dateBefore = before.items.find((item) => item.controlType === 'date');
    expect(dateBefore).toBeDefined();
    // Fixture precondition: the placeholder flag is present before mutation.
    const rawBefore = editor.doc.contentControls.getRawProperties({ target: dateBefore!.target });
    const elementsBefore = (rawBefore.properties as { elements?: Array<{ name: string }> }).elements ?? [];
    expect(elementsBefore.some((el) => el.name === 'w:showingPlcHdr')).toBe(true);

    const result = await Promise.resolve(
      editor.doc.contentControls.date.setValue(
        { target: dateBefore!.target, value: NEW_DATE },
        { changeMode: 'direct' },
      ),
    );
    expect(result.success).toBe(true);

    const rawAfter = editor.doc.contentControls.getRawProperties({ target: dateBefore!.target });
    const elementsAfter = (rawAfter.properties as { elements?: Array<{ name: string }> }).elements ?? [];
    expect(elementsAfter.some((el) => el.name === 'w:showingPlcHdr')).toBe(false);
  });

  // (b) w:fullDate is ST_DateTime (xsd:dateTime): a bare 'YYYY-MM-DD' input must
  // be stored as 'YYYY-MM-DDT00:00:00Z', asserted through the real pipeline so a
  // persistence regression cannot hide behind mocked transaction calls.
  it('stores the normalized xsd:dateTime in w:fullDate', async () => {
    const docData = await loadTestDataForEditorTests('date_control.docx');
    const editor = loadDateEditor(docData);

    const before = editor.doc.contentControls.list();
    const dateBefore = before.items.find((item) => item.controlType === 'date');
    expect(dateBefore).toBeDefined();

    const result = await Promise.resolve(
      editor.doc.contentControls.date.setValue(
        { target: dateBefore!.target, value: NEW_DATE },
        { changeMode: 'direct' },
      ),
    );
    expect(result.success).toBe(true);

    const raw = editor.doc.contentControls.getRawProperties({ target: dateBefore!.target });
    const elements =
      (raw.properties as { elements?: Array<{ name: string; attributes?: Record<string, unknown> }> }).elements ?? [];
    const dateEl = elements.find((el) => el.name === 'w:date');
    expect(dateEl?.attributes?.['w:fullDate']).toBe(`${NEW_DATE}T00:00:00Z`);
  });

  // (c) Visible text must be the date rendered through w:dateFormat (dd/MM/yyyy
  // in the fixture), not the raw ISO input.
  it('renders visible text through the w:dateFormat mask (24/05/2026)', async () => {
    const docData = await loadTestDataForEditorTests('date_control.docx');
    const editor = loadDateEditor(docData);

    const before = editor.doc.contentControls.list();
    const dateBefore = before.items.find((item) => item.controlType === 'date');
    expect(dateBefore).toBeDefined();

    const result = await Promise.resolve(
      editor.doc.contentControls.date.setValue(
        { target: dateBefore!.target, value: NEW_DATE },
        { changeMode: 'direct' },
      ),
    );
    expect(result.success).toBe(true);

    const after = editor.doc.contentControls.list();
    const dateAfter = after.items.find((item) => item.controlType === 'date');
    expect(dateAfter?.text).toContain(MASKED_DATE);
    expect(dateAfter?.text).not.toContain(NEW_DATE);
  });

  // (d) date.setValue advertises 'NO_OP if unchanged'. Setting the same value
  // twice must report NO_OP on the second call, not a fresh success.
  it('returns NO_OP when the same value is set twice', async () => {
    const docData = await loadTestDataForEditorTests('date_control.docx');
    const editor = loadDateEditor(docData);

    const before = editor.doc.contentControls.list();
    const dateBefore = before.items.find((item) => item.controlType === 'date');
    expect(dateBefore).toBeDefined();

    const first = await Promise.resolve(
      editor.doc.contentControls.date.setValue(
        { target: dateBefore!.target, value: NEW_DATE },
        { changeMode: 'direct' },
      ),
    );
    expect(first.success).toBe(true);

    const second = await Promise.resolve(
      editor.doc.contentControls.date.setValue(
        { target: dateBefore!.target, value: NEW_DATE },
        { changeMode: 'direct' },
      ),
    );
    expect(second.success).toBe(false);
    if (!second.success) {
      expect(second.failure.code).toBe('NO_OP');
    }
  });
});
