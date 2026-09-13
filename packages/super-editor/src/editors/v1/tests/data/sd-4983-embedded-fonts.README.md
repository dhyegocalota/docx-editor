# Embedded-font export fixture

`sd-4983-embedded-fonts.docx` is a synthetic package derived from the repository's
blank DOCX. It contains one paragraph, all four font embedding variants
(`embedRegular`, `embedBold`, `embedItalic`, `embedBoldItalic`), distinct font keys,
and four deterministic opaque binary payloads under `word/fonts/`.

The payloads are byte-preservation sentinels, not renderable fonts. The tests
verify package references and exact bytes without distributing customer documents
or licensed font programs. SD-4983's original 11-font document is verified
separately in the private local workflow.
