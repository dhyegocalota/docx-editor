import {
  createAgentToolkit,
  getActionDispositions,
  getToolCatalog,
  type ActionDisposition,
  type ActionName,
  type AgentToolkit,
  type CreateAgentToolkitInput,
} from '../../../packages/sdk/langs/node/dist/index.js';

// The tracked-only policy is an option on the existing toolkit input: only
// 'tracked' is accepted, and the allowlist takes action names or the wildcard.
const input = {
  provider: 'openai',
  preset: 'core',
  enforceChangeMode: 'tracked',
  allowDirectActions: ['add_comments', '*'],
} satisfies CreateAgentToolkitInput;

const toolkit: Promise<AgentToolkit> = createAgentToolkit(input);

// @ts-expect-error — 'direct' is not an enforceable mode.
const rejected = { provider: 'openai', preset: 'core', enforceChangeMode: 'direct' } satisfies CreateAgentToolkitInput;

// Every action has exactly one disposition, keyed by the public ActionName type.
const dispositions: Record<ActionName, ActionDisposition> = getActionDispositions();
const directActions: ActionName[] = (Object.keys(dispositions) as ActionName[]).filter(
  (name) => dispositions[name] === 'direct',
);
const disposition: 'tracked' | 'direct' = dispositions.replace_text;

// The core catalog publishes the same table; other presets leave it undefined.
const catalog = await getToolCatalog('core');
const published: Record<string, 'tracked' | 'direct'> | undefined = catalog.dispositions;

void toolkit;
void rejected;
void directActions;
void disposition;
void published;
