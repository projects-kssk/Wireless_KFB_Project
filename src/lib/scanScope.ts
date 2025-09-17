export type ScanScope = "setup";

type ScanScopeState = {
  setup: string[];
  ts: number;
};

type ScanScopeMessage = {
  state: ScanScopeState;
};

const CHANNEL_NAME = "kfb-scan-scope";
const STORAGE_KEY = "kfb:scan-scope-state";

const ensureWindow = () => typeof window !== "undefined";

const defaultState = (): ScanScopeState => ({ setup: [], ts: Date.now() });

const parseState = (raw: string | null): ScanScopeState => {
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw) as ScanScopeState;
    if (!parsed || typeof parsed !== "object") return defaultState();
    if (!Array.isArray(parsed.setup)) return defaultState();
    return {
      setup: Array.from(new Set(parsed.setup.filter(Boolean))),
      ts: typeof parsed.ts === "number" ? parsed.ts : Date.now(),
    };
  } catch {
    return defaultState();
  }
};

const readState = (): ScanScopeState => {
  if (!ensureWindow()) return defaultState();
  try {
    return parseState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultState();
  }
};

const broadcastState = (state: ScanScopeState) => {
  if (!ensureWindow()) return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ state } satisfies ScanScopeMessage);
    channel.close();
  } catch {}
};

const writeState = (state: ScanScopeState) => {
  if (!ensureWindow()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
  broadcastState(state);
};

const updateState = (scope: ScanScope, token: string, active: boolean) => {
  if (!ensureWindow()) return;
  const current = readState();
  const list = new Set(current[scope]);
  if (active) list.add(token);
  else list.delete(token);
  const next: ScanScopeState = {
    ...current,
    [scope]: Array.from(list),
    ts: Date.now(),
  };
  writeState(next);
};

const makeToken = (scope: ScanScope) =>
  `${scope}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

export const acquireScanScope = (scope: ScanScope): string | null => {
  if (!ensureWindow()) return null;
  const token = makeToken(scope);
  updateState(scope, token, true);
  return token;
};

export const releaseScanScope = (scope: ScanScope, token?: string | null) => {
  if (!ensureWindow()) return;
  if (!token) return;
  updateState(scope, token, false);
};

export const readScanScope = (scope: ScanScope): boolean => {
  if (!ensureWindow()) return false;
  const state = readState();
  return (state[scope] || []).length > 0;
};

export const subscribeScanScope = (
  scope: ScanScope,
  cb: (active: boolean) => void
): (() => void) => {
  if (!ensureWindow()) return () => {};
  const onMessage = (event: MessageEvent<ScanScopeMessage>) => {
    const payload = event?.data?.state;
    if (!payload) return;
    cb((payload[scope] || []).length > 0);
  };
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", onMessage as EventListener);
  } catch {
    channel = null;
  }

  const storageHandler = (ev: StorageEvent) => {
    if (ev.key !== STORAGE_KEY) return;
    const state = parseState(ev.newValue);
    cb((state[scope] || []).length > 0);
  };
  window.addEventListener("storage", storageHandler);

  return () => {
    try {
      if (channel) {
        channel.removeEventListener("message", onMessage as EventListener);
        channel.close();
      }
    } catch {}
    window.removeEventListener("storage", storageHandler);
  };
};
