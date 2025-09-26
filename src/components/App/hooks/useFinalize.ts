import { useCallback } from "react";
import { macKey } from "../utils/mac";

/**
 * React 19 marks `MutableRefObject` as deprecated in type positions.
 * For our purposes we only need a shape with `.current`.
 * Using a structural "RefLike" avoids importing the deprecated type.
 */
export type RefLike<T> = { current: T };

/** Domain types inferred from your usage */
type AliasItem = {
  mac?: string;
  ksk?: string;
  kssk?: string;
};

type LockItem = {
  mac?: string;
  ksk?: string;
  kssk?: string;
};

type AliasesListResponse = {
  items?: AliasItem[];
};

type LocksListResponse = {
  locks?: LockItem[];
};

const isHttpUrl = (u?: string | null): boolean =>
  !!u && /^(https?:)\/\//i.test(u);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `fetch` helpers with safe parsing */
async function safeFetchText(input: RequestInfo, init?: RequestInit) {
  try {
    const r = await fetch(input, init);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

async function safeFetchJson<T>(
  input: RequestInfo,
  init?: RequestInit
): Promise<T | null> {
  try {
    const r = await fetch(input, init);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** Build query strings safely */
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

const dedupeCasePreserving = (
  values: Array<string | null | undefined> | undefined | null
): string[] => {
  if (!values || values.length === 0) return [];
  const map = new Map<string, string>();
  for (const raw of values) {
    const id = String(raw || "").trim();
    if (!id) continue;
    const key = id.toUpperCase();
    if (!map.has(key)) map.set(key, id);
  }
  return Array.from(map.values());
};

/** Hook params (kept API-compatible with your original, but with RefLike<T>) */
export type UseFinalizeParams = {
  cfgRetryCooldownMs: number;
  activeKssks: string[] | undefined;

  setOkSystemNote: (value: string | null) => void;
  setMacAddress: (value: string) => void;
  setKfbNumber: (value: string) => void;
  setSuppressLive: (value: boolean) => void;
  handleResetKfb: () => void;

  lastRunHadFailuresRef: RefLike<boolean>;
  finalizeOkGuardRef: RefLike<Map<string, number>>;
  recentCleanupRef: RefLike<Map<string, number>>;
  blockedMacRef: RefLike<Set<string>>;
  lastScanRef: RefLike<string>;
  lastFinalizedMacRef: RefLike<string | null>;
  lastFinalizedAtRef: RefLike<number>;
  lastActiveIdsRef: RefLike<string[]>;
  itemsAllFromAliasesRef: RefLike<AliasItem[]>;
  checkpointSentRef: RefLike<Set<string>>;
  checkpointMacPendingRef: RefLike<Set<string>>;
  checkpointBlockUntilTsRef: RefLike<number>;
  xmlReadBlockUntilRef: RefLike<Map<string, number>>;

  offlineMode: boolean;
  checkpointUrl: string;
  clientResultUrl: string;
};

export const useFinalize = ({
  cfgRetryCooldownMs,
  activeKssks,
  setOkSystemNote,
  setMacAddress: _setMacAddress,
  setKfbNumber: _setKfbNumber,
  setSuppressLive,
  handleResetKfb,
  lastRunHadFailuresRef,
  finalizeOkGuardRef,
  recentCleanupRef,
  blockedMacRef,
  lastScanRef,
  lastFinalizedMacRef,
  lastFinalizedAtRef,
  lastActiveIdsRef,
  itemsAllFromAliasesRef,
  checkpointSentRef,
  checkpointMacPendingRef,
  checkpointBlockUntilTsRef,
  xmlReadBlockUntilRef,
  offlineMode,
  checkpointUrl,
  clientResultUrl,
}: UseFinalizeParams) => {
  void _setMacAddress;
  void _setKfbNumber;

  const checkpointEnabled = process.env.NEXT_PUBLIC_SEND_CHECKPOINT !== "0";

  /** -------------------------------- Helpers -------------------------------- */

  const uppercaseMac = (m: string) =>
    String(m || "")
      .trim()
      .toUpperCase();

  const now = () => Date.now();

  const within = (ts: number, ms: number) => now() < ts + ms;

  const titleCaseFirst = (s: string) =>
    s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  const addTempBlockForKey = (key: string, ms: number) => {
    try {
      blockedMacRef.current.add(key);
      if (typeof window !== "undefined") {
        setTimeout(() => {
          try {
            blockedMacRef.current.delete(key);
          } catch {}
        }, ms);
      }
    } catch {}
  };

  const setGuardForMac = (mac: string, ms: number) => {
    try {
      finalizeOkGuardRef.current.set(mac, now() + ms);
    } catch {}
  };

  const isGuardActive = (mac: string) => {
    try {
      const until = finalizeOkGuardRef.current.get(mac) || 0;
      return now() < until;
    } catch {
      return false;
    }
  };

  const recordFinalizeStamp = (mac: string) => {
    try {
      lastFinalizedMacRef.current = mac;
      lastFinalizedAtRef.current = now();
    } catch {}
  };

  const markRecentCleanup = (mac: string) => {
    try {
      recentCleanupRef.current.set(mac, now());
    } catch {}
  };

  const wasRecentlyCleaned = (mac: string, withinMs: number) => {
    try {
      const ts = recentCleanupRef.current.get(mac) || 0;
      return now() - ts < withinMs;
    } catch {
      return false;
    }
  };

  /** Fetch and verify aliases clear for MAC */
  const clearAliasesVerify = useCallback(async (mac: string) => {
    const MAC = uppercaseMac(mac);
    const attemptClear = async () =>
      fetch("/api/aliases/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: MAC }),
      }).catch(() => {});

    const verify = async (): Promise<boolean> => {
      try {
        const r = await fetch(
          `/api/aliases?mac=${encodeURIComponent(MAC)}&all=1`,
          { cache: "no-store" }
        );
        if (!r.ok) return false;
        const j = (await r.json()) as AliasesListResponse;
        return Array.isArray(j?.items) ? j.items.length === 0 : false;
      } catch {
        return false;
      }
    };

    await attemptClear();
    let ok = await verify();
    for (let i = 0; !ok && i < 2; i++) {
      await sleep(250);
      await attemptClear();
      ok = await verify();
    }
  }, []);

  /** Locks helpers */
  const countLocksForMac = useCallback(
    async (mac: string): Promise<number | null> => {
      const MAC = uppercaseMac(mac);
      if (!MAC) return 0;
      const v = await safeFetchJson<LocksListResponse>(`/api/ksk-lock`, {
        cache: "no-store",
      });
      if (!v || !Array.isArray(v?.locks)) return null;
      return v.locks.filter((x: LockItem) => uppercaseMac(x?.mac || "") === MAC)
        .length;
    },
    []
  );

  const clearKskLocksFully = useCallback(
    async (mac: string): Promise<boolean> => {
      const MAC = uppercaseMac(mac);
      if (!MAC) return true;

      const preCount = await countLocksForMac(MAC);
      if (preCount === 0) return true;

      const MAX = 3;
      for (let i = 0; i < MAX; i++) {
        await fetch(`/api/ksk-lock?${qs({ mac: MAC, force: "1" })}`, {
          method: "DELETE",
        }).catch(() => {});
        await sleep(150);
        const left = await countLocksForMac(MAC);
        if (left === 0) return true;
      }
      return false;
    },
    [countLocksForMac]
  );

  /** Checkpoint sender */
  const sendCheckpointForMac = useCallback(
    async (mac: string, onlyIds?: string[]): Promise<boolean> => {
      if (!checkpointEnabled) return false;

      const MAC = uppercaseMac(mac);
      const blockedUntil = checkpointBlockUntilTsRef.current || 0;
      if (blockedUntil && now() < blockedUntil) return false;
      if (checkpointMacPendingRef.current.has(MAC)) return false;

      checkpointMacPendingRef.current.add(MAC);
      try {
        // Gather IDs from aliases (primary) or fallback to onlyIds
        let items: AliasItem[] = [];
        let ids: string[] = [];
        try {
          const rList = await fetch(
            `/api/aliases?mac=${encodeURIComponent(MAC)}&all=1`,
            { cache: "no-store" }
          );
          if (rList.ok) {
            const j = (await rList.json()) as AliasesListResponse;
            items = Array.isArray(j?.items) ? (j.items as AliasItem[]) : [];
            ids = items
              .map((it: AliasItem) => String((it.ksk ?? it.kssk) || "").trim())
              .filter(Boolean);
          }
        } catch {}

        // Normalize "onlyIds"
        const onlyIdsNormalized = Array.isArray(onlyIds)
          ? Array.from(
              new Set(
                onlyIds.map((s) => String(s || "").trim()).filter(Boolean)
              )
            )
          : [];

        if ((!ids || ids.length === 0) && onlyIdsNormalized.length) {
          ids = [...onlyIdsNormalized];
        }
        if (onlyIdsNormalized.length) {
          const want = new Set(onlyIdsNormalized.map((s) => s.toUpperCase()));
          ids = ids.filter((id) => want.has(id.toUpperCase()));
          if (ids.length === 0 && onlyIdsNormalized.length) {
            ids = [...onlyIdsNormalized];
          }
        }
        if (ids.length) {
          const seen = new Set<string>();
          ids = ids
            .map((id) => String(id || "").trim())
            .filter((id) => {
              if (!id) return false;
              const key = id.toUpperCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
        }

        let sentAny = false;

        for (const id of ids) {
          if (checkpointSentRef.current.has(id)) continue;

          // Attempt to read XML (with ensure), up to 3 tries
          let workingDataXml: string | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const blockUntil = xmlReadBlockUntilRef.current.get(MAC) || 0;
              if (now() < blockUntil) break;

              const rXml = await fetch(
                `/api/aliases/xml?mac=${encodeURIComponent(MAC)}&kssk=${encodeURIComponent(id)}`,
                { cache: "no-store" }
              );
              if (rXml.ok) {
                workingDataXml = await rXml.text();
                break;
              }
              if (rXml.status === 404 && attempt === 0) {
                const ensure = await fetch("/api/aliases/xml/ensure", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    mac: MAC,
                    ksk: id,
                    requestID: `${now()}_${id}`,
                  }),
                }).catch(() => null);
                if (ensure && ensure.ok) {
                  const r2 = await fetch(
                    `/api/aliases/xml?mac=${encodeURIComponent(MAC)}&kssk=${encodeURIComponent(id)}`,
                    { cache: "no-store" }
                  ).catch(() => null);
                  if (r2 && r2.ok) {
                    workingDataXml = await r2.text();
                    break;
                  }
                } else {
                  await sleep(250);
                  continue;
                }
              }
            } catch {}
            await sleep(250);
          }

          // Build checkpoint payload
          const payload: Record<string, unknown> = {
            requestID: `${now()}_${id}`,
            intksk: id,
            forceResult: true,
            ...(workingDataXml ? { workingDataXml } : {}),
            ...(offlineMode && isHttpUrl(clientResultUrl)
              ? { checkpointUrl: clientResultUrl }
              : {}),
          };

          try {
            const payloadIntksk = String(payload.intksk || "").trim();
            if (!payloadIntksk) continue;
            payload.intksk = payloadIntksk;

            const resp = await fetch(checkpointUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify(payload),
            });

            const checkpointErrHeader = resp.headers.get(
              "X-Krosy-Checkpoint-Error"
            );
            const respOk = resp.ok && !checkpointErrHeader;

            if (!respOk) {
              // Backoff policies based on server response
              if (resp.status >= 500 || checkpointErrHeader) {
                checkpointBlockUntilTsRef.current = now() + 120_000;
                continue;
              }
              if (resp.status === 429) {
                checkpointBlockUntilTsRef.current = now() + 30_000;
                continue;
              }
            } else {
              checkpointSentRef.current.add(id);
              sentAny = true;
            }
          } catch {
            checkpointBlockUntilTsRef.current = now() + 60_000;
            continue;
          }
        }

        return sentAny;
      } finally {
        checkpointMacPendingRef.current.delete(MAC);
      }
    },
    [
      checkpointEnabled,
      checkpointUrl,
      offlineMode,
      clientResultUrl,
      checkpointMacPendingRef,
      checkpointSentRef,
      xmlReadBlockUntilRef,
      checkpointBlockUntilTsRef,
    ]
  );

  /** Centralized ID gathering with the same priority you used */
  const gatherIdsForMac = useCallback(
    async (
      mac: string
    ): Promise<{
      ids: string[];
      hadAliases: boolean;
      hadLocksForMac: boolean;
      hadAnySnapshot: boolean;
    }> => {
      const MAC = uppercaseMac(mac);

      // 1) Prefer current "lastActiveIds" if present, otherwise activeKssks.
      let ids: string[] = [];
      if (Array.isArray(lastActiveIdsRef.current) && lastActiveIdsRef.current.length) {
        ids = [...lastActiveIdsRef.current];
      } else if (Array.isArray(activeKssks) && activeKssks.length) {
        ids = [...activeKssks];
      }

      let hadAliases = false;
      let hadLocksForMac = ids.length > 0; // if we already have active IDs, treat as "locks context"
      let hadAnySnapshot = false;

      // 2) If still empty, query aliases
      if (!ids.length) {
        try {
          const r = await fetch(
            `/api/aliases?mac=${encodeURIComponent(MAC)}&all=1`,
            { cache: "no-store" }
          );
          if (r.ok) {
            const j = (await r.json()) as AliasesListResponse;
            const items: AliasItem[] = Array.isArray(j?.items)
              ? (j.items as AliasItem[])
              : [];
            ids = Array.from(
              new Set(
                items
                  .map((it: AliasItem) =>
                    String((it?.ksk ?? it?.kssk) || "").trim()
                  )
                  .filter(Boolean)
              )
            );
            if (items.length) hadAliases = true;
          }
        } catch {}
      }

      // 3) If still empty, query locks for this MAC
      if (!ids.length) {
        try {
          const rLocks = await fetch(`/api/ksk-lock`, {
            cache: "no-store",
          }).catch(() => null);
          if (rLocks && rLocks.ok) {
            const jL = await rLocks.json().catch(() => null);
            const locks: LockItem[] = Array.isArray(jL?.locks)
              ? (jL.locks as LockItem[])
              : [];
            const wantMac = MAC;
            const fromLocks = locks
              .filter(
                (row: LockItem) => uppercaseMac(row?.mac || "") === wantMac
              )
              .map((row: LockItem) =>
                String((row?.ksk ?? row?.kssk) || "").trim()
              )
              .filter(Boolean);
            if (fromLocks.length) {
              ids = Array.from(new Set(fromLocks));
              hadLocksForMac = true;
            }
          }
        } catch {}
      }

      // 4) Snapshot fallback
      if (!ids.length) {
        try {
          const snapshot = itemsAllFromAliasesRef.current || [];
          hadAnySnapshot = snapshot.length > 0;
          if (snapshot.length) {
            const fromSnap = Array.from(
              new Set(
                snapshot
                  .map((it: AliasItem) =>
                    String((it.ksk ?? it.kssk) || "").trim()
                  )
                  .filter(Boolean)
              )
            );
            if (fromSnap.length) ids = fromSnap;
          }
        } catch {}
      }

      // 5) Dedup & normalize
      ids = dedupeCasePreserving(
        ids.map((s) => String(s || "").trim()).filter(Boolean)
      );

      // 6) One more safety net: if still empty, reuse active lists (again) or lastActiveIds
      if (
        (!ids || ids.length === 0) &&
        Array.isArray(activeKssks) &&
        activeKssks.length > 0
      ) {
        ids = dedupeCasePreserving(activeKssks);
      }
      if (
        (!ids || ids.length === 0) &&
        Array.isArray(lastActiveIdsRef.current) &&
        lastActiveIdsRef.current.length > 0
      ) {
        ids = dedupeCasePreserving(lastActiveIdsRef.current);
      }

      return { ids, hadAliases, hadLocksForMac, hadAnySnapshot };
    },
    [activeKssks, itemsAllFromAliasesRef, lastActiveIdsRef]
  );

  /** -------------------------------- Flow ----------------------------------- */

  const finalizeOkForMac = useCallback(
    async (rawMac: string) => {
      const mac = uppercaseMac(rawMac);
      if (!mac) {
        handleResetKfb();
        return;
      }
      if (lastRunHadFailuresRef.current) return;

      // Guard against too-frequent finalize calls for this MAC
      const guardWindowMs = Math.max(2000, cfgRetryCooldownMs);
      if (isGuardActive(mac)) return;
      setGuardForMac(mac, guardWindowMs);

      // Avoid double-cleaning the same MAC within a short window
      if (wasRecentlyCleaned(mac, 5000)) return;

      // Enter "finalize" mode in UI: freeze live updates during critical mutations
      setSuppressLive(true);

      // Mark the MAC as "finalized" now (for observability/debug)
      recordFinalizeStamp(mac);

      // Temporarily block updates for current and last scanned keys
      try {
        const curKey = macKey(mac);
        addTempBlockForKey(curKey, cfgRetryCooldownMs);

        const lastRaw = uppercaseMac(lastScanRef.current || "");
        const lastKey = lastRaw ? macKey(lastRaw) : null;
        if (lastKey && lastKey !== curKey) {
          addTempBlockForKey(lastKey, cfgRetryCooldownMs);
        }
      } catch {}

      try {
        // 1) Collect KSK/KSSK IDs tied to this MAC (preserving your precedence)
        const { ids, hadAliases, hadLocksForMac, hadAnySnapshot } =
          await gatherIdsForMac(mac);

        const hasSetup =
          (ids?.length ?? 0) > 0 ||
          (Array.isArray(activeKssks) && activeKssks.length > 0) ||
          (Array.isArray(lastActiveIdsRef.current) &&
            lastActiveIdsRef.current.length > 0) ||
          hadAnySnapshot;

        // Track which ops ran, for the user note
        const ops: { checkpoint: boolean; aliases: boolean; locks: boolean } = {
          checkpoint: false,
          aliases: false,
          locks: false,
        };

        // 2) Send checkpoint if we have IDs
        if ((ids?.length ?? 0) > 0) {
          ops.checkpoint = await sendCheckpointForMac(mac, ids).catch(
            () => false
          );
        }

        // 3) Clear aliases (verify) when there is context (setup/aliases/snapshot)
        if (hasSetup || hadAliases || hadAnySnapshot) {
          await clearAliasesVerify(mac);
          ops.aliases = true;
        }

        // 4) Clear locks for this MAC when indicated by context/locks presence
        let shouldClearLocks =
          hadLocksForMac ||
          (Array.isArray(activeKssks) && activeKssks.length > 0) ||
          hasSetup;

        let lockCountBefore: number | null = null;
        if (shouldClearLocks) {
          try {
            lockCountBefore = await countLocksForMac(mac);
            if (lockCountBefore === 0) shouldClearLocks = false;
          } catch {}
        }

        if (shouldClearLocks) {
          let locksCleared = await clearKskLocksFully(mac);
          for (let i = 0; !locksCleared && i < 2; i++) {
            await sleep(250);
            locksCleared = await clearKskLocksFully(mac);
          }

          if (!locksCleared && lockCountBefore !== 0) {
            try {
              const sid = (process.env.NEXT_PUBLIC_STATION_ID || "").trim();
              if (sid) {
                await fetch("/api/ksk-lock", {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ stationId: sid, mac, force: 1 }),
                }).catch(() => {});
              }
            } catch {}
          }
          ops.locks = locksCleared;
        }

        // 5) Build "OK system note" message mirroring your style
        const parts: string[] = [];
        if (ops.checkpoint) parts.push("checkpoint sent");
        if (ops.aliases) parts.push("cache cleared");
        if (ops.locks) parts.push("locks cleared");

        if (!parts.length) {
          setOkSystemNote("Nothing to clear");
        } else {
          const first = parts.shift() as string;
          const tail = parts.length ? `; ${parts.join("; ")}` : "";
          setOkSystemNote(titleCaseFirst(`${first}${tail}`));
        }
      } finally {
        // Always perform housekeeping + UI cleanup
        try {
          checkpointSentRef.current.clear();
        } catch {}
        try {
          xmlReadBlockUntilRef.current.set(mac, now() + 60_000);
          markRecentCleanup(mac);
          setGuardForMac(mac, Math.max(2000, cfgRetryCooldownMs));
        } catch {}
        handleResetKfb();
      }
    },
    [
      cfgRetryCooldownMs,
      activeKssks,
      lastRunHadFailuresRef,
      setSuppressLive,
      recordFinalizeStamp,
      gatherIdsForMac,
      sendCheckpointForMac,
      clearAliasesVerify,
      countLocksForMac,
      clearKskLocksFully,
      checkpointSentRef,
      xmlReadBlockUntilRef,
      handleResetKfb,
      lastScanRef,
      blockedMacRef,
      finalizeOkGuardRef,
      recentCleanupRef,
      lastActiveIdsRef,
      setOkSystemNote,
    ]
  );

  return { finalizeOkForMac, clearKskLocksFully };
};

export default useFinalize;
