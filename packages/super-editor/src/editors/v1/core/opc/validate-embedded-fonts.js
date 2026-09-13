import * as xmljs from 'xml-js';
import { resolveOpcTargetPath } from '../super-converter/helpers.js';

const EMBEDDINGS = new Set(['embedRegular', 'embedBold', 'embedItalic', 'embedBoldItalic']);
const RELATIONSHIP_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
]);

/** Collect font relationship IDs, honoring aliases for the r: namespace. */
function collectEmbeddingIds(node, namespaces = {}, ids = []) {
  const bindings = { ...namespaces };
  for (const [name, value] of Object.entries(node.attributes ?? {})) {
    if (name.startsWith('xmlns:')) bindings[name.slice(6)] = value;
  }
  if (EMBEDDINGS.has(node.name?.split(':').pop())) {
    const idAttribute = Object.keys(node.attributes ?? {}).find((name) => {
      const [prefix, localName] = name.split(':');
      return localName === 'id' && RELATIONSHIP_NAMESPACES.has(bindings[prefix]);
    });
    ids.push(idAttribute ? node.attributes[idAttribute] : undefined);
  }
  for (const child of node.elements ?? []) collectEmbeddingIds(child, bindings, ids);
  return ids;
}

/**
 * Reject incomplete embedded fonts without rewriting the source font table or
 * changing obfuscated bytes/font keys. Called on the final export ZIP.
 * @param {import('jszip')} zip
 * @returns {Promise<void>}
 */
export async function validateEmbeddedFonts(zip) {
  const table = zip.file('word/fontTable.xml');
  if (!table) return;

  const ids = collectEmbeddingIds(xmljs.xml2js(await table.async('string'), { compact: false }));
  if (ids.length === 0) return;

  const relsPart = zip.file('word/_rels/fontTable.xml.rels');
  if (!relsPart) {
    throw new Error('Cannot export embedded fonts: word/_rels/fontTable.xml.rels is missing.');
  }
  const rels = xmljs.xml2js(await relsPart.async('string'), { compact: false });
  const root = rels.elements?.find((node) => node.name?.split(':').pop() === 'Relationships');
  const relationships = root?.elements?.filter((node) => node.name?.split(':').pop() === 'Relationship') ?? [];

  for (const id of ids) {
    const matches = relationships.filter((node) => node.attributes?.Id === id);
    const relationship = matches[0]?.attributes;
    const target = resolveOpcTargetPath(relationship?.Target);
    if (
      !id ||
      matches.length !== 1 ||
      ![...RELATIONSHIP_NAMESPACES].some((namespace) => relationship.Type === `${namespace}/font`) ||
      relationship.TargetMode === 'External' ||
      !target ||
      !zip.file(target)
    ) {
      throw new Error(
        `Cannot export embedded font ${id ?? '(missing r:id)'}: its font relationship or binary is unavailable.`,
      );
    }
  }
}
