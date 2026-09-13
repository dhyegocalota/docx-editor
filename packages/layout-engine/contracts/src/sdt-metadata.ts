import type { SdtMetadata } from './index.js';

/** Shared paint identity for SDT metadata, independent of the control's text. */
export function getSdtMetadataVersion(metadata: SdtMetadata | null | undefined): string {
  if (!metadata) return '';
  if (metadata.type === 'structuredContent') {
    return JSON.stringify([
      metadata.type,
      metadata.scope,
      metadata.id ?? '',
      metadata.alias ?? '',
      metadata.tag ?? '',
      metadata.lockMode ?? '',
      metadata.appearance ?? '',
    ]);
  }
  const id = 'id' in metadata && metadata.id != null ? String(metadata.id) : '';
  return [metadata.type, '', id].join(':');
}
