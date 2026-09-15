import { SuperDoc } from 'superdoc';
import type {
  Config,
  DiagnosticsConfig,
  InteractionHistoryConfig,
  InteractionHistoryEvent,
  InteractionHistorySnapshot,
  SuperDocDiagnostics,
} from 'superdoc';

const history: InteractionHistoryConfig = { enabled: true, maxEvents: 500, maxBytes: 1_048_576, captureContent: false };
const diagnostics: DiagnosticsConfig = { history };
const config: Config = { selector: '#editor', diagnostics };
declare const superdoc: SuperDoc;
const handle: SuperDocDiagnostics = superdoc.diagnostics;
const snapshot: InteractionHistorySnapshot = handle.getSnapshot();
const events: InteractionHistoryEvent[] = snapshot.events;
const cleared: void = handle.clear();
// @ts-expect-error snapshot export takes no options
handle.getSnapshot({ includeText: true });
// @ts-expect-error limits must be numbers
const invalid: InteractionHistoryConfig = { maxEvents: '500' };
export { config, snapshot, events, cleared, invalid };
type DiagnosticsHandle = SuperDoc['diagnostics'];
const typedHandle: DiagnosticsHandle = handle;
export { typedHandle };
