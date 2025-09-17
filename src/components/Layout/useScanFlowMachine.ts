import { Dispatch, useCallback, useEffect, useMemo, useReducer, useRef } from "react";

// Reducer-driven flow controller for the scan → check → finalize lifecycle.

export type ScanTrigger = "sse" | "poll" | "manual";

export type FlowStatus =
  | "idle"
  | "scanning"
  | "checking"
  | "finalizing"
  | "ok"
  | "fail";

enum FlowEventType {
  SetupStart = "setup/start",
  SetupEnd = "setup/end",
  ScanRequested = "scan/request",
  ScanCancelled = "scan/cancel",
  CheckStarted = "check/start",
  CheckResolved = "check/result",
  FinalizeOk = "finalize/ok",
  FinalizeFail = "finalize/fail",
  CooldownUntil = "cooldown/until",
  BlockAdd = "block/add",
  BlockClear = "block/clear",
  SessionNew = "session/new",
}

export interface FlowPins {
  normal: readonly string[];
  latch: readonly string[];
}

export interface CheckOutcome {
  kind: "ok" | "fail";
  payload?: unknown;
}

interface FlowResult {
  outcome: CheckOutcome;
  receivedAt: number;
}

interface FlowState {
  status: FlowStatus;
  mac: string | null;
  trigger: ScanTrigger | null;
  pins: FlowPins | null;
  checkId: string | null;
  lastResult: FlowResult | null;
  isSetupActive: boolean;
  suppressLive: boolean;
  cooldownUntil: number | null;
  blocked: Record<string, number>;
  session: number;
  lastEventAt: number;
}

export type FlowEvent =
  | { type: FlowEventType.SetupStart }
  | { type: FlowEventType.SetupEnd }
  | {
      type: FlowEventType.ScanRequested;
      mac: string;
      trigger: ScanTrigger;
      pins?: FlowPins | null;
    }
  | { type: FlowEventType.ScanCancelled; reason?: string }
  | { type: FlowEventType.CheckStarted; mac: string; requestId: string }
  | {
      type: FlowEventType.CheckResolved;
      mac: string;
      requestId: string | null;
      outcome: CheckOutcome;
    }
  | { type: FlowEventType.FinalizeOk; mac: string }
  | { type: FlowEventType.FinalizeFail; mac: string; reason?: string }
  | { type: FlowEventType.CooldownUntil; until: number }
  | { type: FlowEventType.BlockAdd; mac: string; until: number }
  | { type: FlowEventType.BlockClear; mac?: string }
  | { type: FlowEventType.SessionNew; session: number; suppressLive?: boolean };

const now = () => Date.now();

const INITIAL_STATE: FlowState = {
  status: "idle",
  mac: null,
  trigger: null,
  pins: null,
  checkId: null,
  lastResult: null,
  isSetupActive: false,
  suppressLive: false,
  cooldownUntil: null,
  blocked: {},
  session: 0,
  lastEventAt: now(),
};

const resetToIdle = (state: FlowState): FlowState => ({
  ...state,
  status: "idle",
  mac: null,
  trigger: null,
  pins: null,
  checkId: null,
  lastResult: null,
  lastEventAt: now(),
});

const reducer = (state: FlowState, event: FlowEvent): FlowState => {
  switch (event.type) {
    case FlowEventType.SetupStart: {
      if (state.isSetupActive) return state;
      return {
        ...resetToIdle(state),
        isSetupActive: true,
        suppressLive: true,
      };
    }
    case FlowEventType.SetupEnd: {
      if (!state.isSetupActive) return state;
      return {
        ...state,
        isSetupActive: false,
        suppressLive: false,
        lastEventAt: now(),
      };
    }
    case FlowEventType.ScanRequested: {
      if (state.isSetupActive) return state;
      return {
        ...state,
        status: "scanning",
        mac: event.mac.toUpperCase(),
        trigger: event.trigger,
        pins: event.pins ?? null,
        lastResult: null,
        lastEventAt: now(),
      };
    }
    case FlowEventType.ScanCancelled: {
      return resetToIdle(state);
    }
    case FlowEventType.CheckStarted: {
      if (!state.mac) {
        return {
          ...state,
          status: "checking",
          mac: event.mac.toUpperCase(),
          checkId: event.requestId,
          lastEventAt: now(),
        };
      }
      return {
        ...state,
        status: "checking",
        mac: state.mac || event.mac.toUpperCase(),
        checkId: event.requestId,
        lastEventAt: now(),
      };
    }
    case FlowEventType.CheckResolved: {
      if (state.checkId && event.requestId && state.checkId !== event.requestId)
        return state;
      if (state.mac && state.mac !== event.mac.toUpperCase()) return state;
      const nextStatus: FlowStatus =
        event.outcome.kind === "ok" ? "ok" : "fail";
      return {
        ...state,
        status: nextStatus,
        lastResult: {
          outcome: event.outcome,
          receivedAt: now(),
        },
        lastEventAt: now(),
      };
    }
    case FlowEventType.FinalizeOk: {
      if (state.mac && state.mac !== event.mac.toUpperCase()) return state;
      return {
        ...resetToIdle(state),
        status: "finalizing",
        lastEventAt: now(),
      };
    }
    case FlowEventType.FinalizeFail: {
      if (state.mac && state.mac !== event.mac.toUpperCase()) return state;
      return {
        ...state,
        status: "fail",
        lastEventAt: now(),
      };
    }
    case FlowEventType.CooldownUntil: {
      const until = Math.max(event.until, state.cooldownUntil ?? 0);
      return {
        ...state,
        cooldownUntil: until,
        lastEventAt: now(),
      };
    }
    case FlowEventType.BlockAdd: {
      const blocked = { ...state.blocked, [event.mac.toUpperCase()]: event.until };
      return {
        ...state,
        blocked,
        lastEventAt: now(),
      };
    }
    case FlowEventType.BlockClear: {
      if (!event.mac) {
        return {
          ...state,
          blocked: {},
          lastEventAt: now(),
        };
      }
      const next = { ...state.blocked };
      delete next[event.mac.toUpperCase()];
      return {
        ...state,
        blocked: next,
        lastEventAt: now(),
      };
    }
    case FlowEventType.SessionNew: {
      return {
        ...resetToIdle(state),
        session: event.session,
        suppressLive: event.suppressLive ?? state.suppressLive,
        cooldownUntil: null,
        blocked: {},
      };
    }
    default:
      return state;
  }
};

interface SessionGuards {
  beginSession: (options?: { suppressLive?: boolean }) => number;
  currentSession: () => number;
  isStale: (session: number) => boolean;
}

export interface ScanFlowMachine {
  state: FlowState;
  dispatch: Dispatch<FlowEvent>;
  session: SessionGuards;
  isOnCooldown: (at?: number) => boolean;
  isMacBlocked: (mac: string, at?: number) => boolean;
}

const createInitialState = (seed?: Partial<FlowState>): FlowState => ({
  ...INITIAL_STATE,
  ...seed,
  blocked: seed?.blocked ? { ...seed.blocked } : {},
});

/**
 * Provides a reducer-driven state machine for migrating the existing scan/check/finalize flow.
 * Dispatch events from handlers, and use the session guards to ignore stale async responses.
 */
export function useScanFlowMachine(seed?: Partial<FlowState>): ScanFlowMachine {
  const [state, dispatch] = useReducer(reducer, seed, createInitialState);
  const sessionRef = useRef(state.session);

  useEffect(() => {
    sessionRef.current = state.session;
  }, [state.session]);

  const beginSession = useCallback(
    (options?: { suppressLive?: boolean }) => {
      sessionRef.current += 1;
      dispatch({
        type: FlowEventType.SessionNew,
        session: sessionRef.current,
        suppressLive: options?.suppressLive,
      });
      return sessionRef.current;
    },
    [dispatch]
  );

  const currentSession = useCallback(() => sessionRef.current, []);

  const isStale = useCallback((session: number) => session !== sessionRef.current, []);

  const isOnCooldown = useCallback(
    (at?: number) => {
      if (state.cooldownUntil == null) return false;
      const ts = at ?? now();
      return ts < state.cooldownUntil;
    },
    [state.cooldownUntil]
  );

  const isMacBlocked = useCallback(
    (mac: string, at?: number) => {
      const key = mac.toUpperCase();
      const until = state.blocked[key];
      if (!until) return false;
      const ts = at ?? now();
      return ts < until;
    },
    [state.blocked]
  );

  const sessionGuards = useMemo<SessionGuards>(
    () => ({ beginSession, currentSession, isStale }),
    [beginSession, currentSession, isStale]
  );

  return useMemo(
    () => ({
      state,
      dispatch,
      session: sessionGuards,
      isOnCooldown,
      isMacBlocked,
    }),
    [state, dispatch, sessionGuards, isOnCooldown, isMacBlocked]
  );
}

export { FlowEventType };
export type { FlowState };
