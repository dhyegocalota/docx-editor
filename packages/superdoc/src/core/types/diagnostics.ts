/** Bounded local capture. Content capture can include document text and error messages. */
export interface InteractionHistoryConfig {
  enabled?: boolean;
  /** Defaults to 500; accepted range 1–10,000. */
  maxEvents?: number;
  /** Retained serialized UTF-16 payload budget. Defaults to 1 MiB; maximum 16 MiB. */
  maxBytes?: number;
  captureContent?: boolean;
}
export interface DiagnosticsConfig {
  history?: InteractionHistoryConfig;
}
export interface InteractionHistoryEvent {
  sequence: number;
  observedAt: number;
  type: string;
  data: Record<string, unknown>;
  truncated: boolean;
}
/** Observation order is local to this instance; it is not collaboration server order. */
export interface InteractionHistorySnapshot {
  schemaVersion: 1;
  sessionId: string;
  version: string;
  enabled: boolean;
  events: InteractionHistoryEvent[];
  retainedBytes: number;
  evictedEvents: number;
  truncatedEvents: number;
  captureFailures: number;
}
export interface SuperDocDiagnostics {
  /** Synchronous, detached JSON data; does not call the editor or its worker. */
  getSnapshot(): InteractionHistorySnapshot;
  clear(): void;
}
