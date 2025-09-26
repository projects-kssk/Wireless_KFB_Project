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

  const clearAliasesVerify = useCallback(async (mac: string) => {
    const MAC = mac.toUpperCase();
    await fetch("/api/aliases/clear", {
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
    let ok = await verify();
    for (let i = 0; !ok && i < 2; i++) {
      await sleep(250);
      await fetch("/api/aliases/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: MAC }),
      }).catch(() => {});
      ok = await verify();
    }
  }, []);

  const clearKskLocksFully = useCallback(
    async (mac: string): Promise<boolean> => {
      const MAC = mac.toUpperCase();
      for (let i = 0; i < 3; i++) {
        await fetch(`/api/ksk-lock?${qs({ mac: MAC, force: "1" })}`, {
          method: "DELETE",
        }).catch(() => {});
        await sleep(150);
        const v = await safeFetchJson<LocksListResponse>(`/api/ksk-lock`, {
          cache: "no-store",
        });
        const left = Array.isArray(v?.locks)
          ? v.locks.filter(
              (x: LockItem) => String(x?.mac || "").toUpperCase() === MAC
            ).length
          : 0;
        if (left === 0) return true;
      }
      return false;
    },
    []
  );

  const sendCheckpointForMac = useCallback(
    async (mac: string, onlyIds?: string[]): Promise<boolean> => {
      const MAC = mac.toUpperCase();
      if (checkpointMacPendingRef.current.has(MAC)) return false;
      checkpointMacPendingRef.current.add(MAC);
      try {
        let ids: string[] = [];
        let items: AliasItem[] = [];
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
        if ((!ids || ids.length === 0) && onlyIds && onlyIds.length) {
          ids = [
            ...new Set(onlyIds.map((s) => String(s).trim()).filter(Boolean)),
          ];
        }
        if (onlyIds && onlyIds.length) {
          const want = new Set(
            onlyIds.map((s) =>
              String(s || "")
                .trim()
                .toUpperCase()
            )
          );
          ids = ids.filter((id) => want.has(id.toUpperCase()));
          if (ids.length === 0 && items.length) {
            const first = items[0];
            const firstId = String(first?.ksk ?? first?.kssk ?? "").trim();
            ids = [firstId].filter(Boolean) as string[];
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

          let workingDataXml: string | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const blockUntil = xmlReadBlockUntilRef.current.get(MAC) || 0;
              if (Date.now() < blockUntil) break;
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
                    requestID: `${Date.now()}_${id}`,
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

          const payload: Record<string, unknown> = {
            requestID: `${Date.now()}_${id}`,
            intksk: id,
            forceResult: true,
            ...(workingDataXml ? { workingDataXml } : {}),
            ...(offlineMode && isHttpUrl(clientResultUrl)
              ? { checkpointUrl: clientResultUrl }
              : {}),
          };

          try {
            const resp = await fetch(checkpointUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify(payload),
            });
            if (!resp.ok) {
              if (resp.status >= 500) {
                checkpointBlockUntilTsRef.current = Date.now() + 120_000;
              }
            } else {
              checkpointSentRef.current.add(id);
              sentAny = true;
            }
          } catch {
            checkpointBlockUntilTsRef.current = Date.now() + 60_000;
          }
        }
        return sentAny;
      } finally {
        checkpointMacPendingRef.current.delete(MAC);
      }
    },
    [
      checkpointUrl,
      offlineMode,
      clientResultUrl,
      checkpointMacPendingRef,
      checkpointSentRef,
      xmlReadBlockUntilRef,
      checkpointBlockUntilTsRef,
    ]
  );

  const finalizeOkForMac = useCallback(
    async (rawMac: string) => {
      const mac = String(rawMac || "")
        .trim()
        .toUpperCase();
      if (!mac) {
        handleResetKfb();
        return;
      }
      const macKeyCurrent = macKey(mac);
      if (lastRunHadFailuresRef.current) return;

      const guardWindowMs = Math.max(2000, cfgRetryCooldownMs);
      const guard = finalizeOkGuardRef.current;
      const guardUntil = guard.get(mac) || 0;
      const nowTs = Date.now();
      if (guardUntil && nowTs < guardUntil) return;
      guard.set(mac, nowTs + guardWindowMs);
      try {
        const last = recentCleanupRef.current.get(mac) || 0;
        if (Date.now() - last < 5000) return;
      } catch {}

      try {
        setSuppressLive(true);

        try {
          blockedMacRef.current.add(macKeyCurrent);
          if (typeof window !== "undefined") {
            setTimeout(() => {
              try {
                blockedMacRef.current.delete(macKeyCurrent);
              } catch {}
            }, cfgRetryCooldownMs);
          }
          const lastRaw = (lastScanRef.current || "").toUpperCase();
          const lastKey = lastRaw ? macKey(lastRaw) : null;
          if (lastKey && lastKey !== macKeyCurrent) {
            blockedMacRef.current.add(lastKey);
            if (typeof window !== "undefined") {
              setTimeout(() => {
                try {
                  blockedMacRef.current.delete(lastKey);
                } catch {}
              }, cfgRetryCooldownMs);
            }
          }
        } catch {}

        try {
          lastFinalizedMacRef.current = mac;
          lastFinalizedAtRef.current = Date.now();
        } catch {}

        let ids =
          lastActiveIdsRef.current && lastActiveIdsRef.current.length
            ? [...lastActiveIdsRef.current]
            : [...(activeKssks || [])];
        let hadAliases = false;
        let hadLocksForMac = false;
        if (ids.length) {
          hadLocksForMac = true;
        }

        if (!ids.length) {
          try {
            const r = await fetch(
              `/api/aliases?mac=${encodeURIComponent(mac)}&all=1`,
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
                const wantMac = (mac || "").toUpperCase();
                const fromLocks = locks
                  .filter(
                    (row: LockItem) =>
                      String(row?.mac || "").toUpperCase() === wantMac
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
          if (!ids.length) {
            try {
              const snapshot = itemsAllFromAliasesRef.current || [];
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
                if (fromSnap.length) {
                  ids = fromSnap;
                  hadAliases = true;
                }
              }
            } catch {}
          }
        }

        let hasSetup = ids.length > 0;

        const mutableOps: {
          checkpoint: boolean;
          aliases: boolean;
          locks: boolean;
        } = {
          checkpoint: false,
          aliases: false,
          locks: false,
        };

        if (hasSetup) {
          mutableOps.checkpoint = await sendCheckpointForMac(mac, ids).catch(
            () => false
          );
        }

        const snapshotCount = Array.isArray(itemsAllFromAliasesRef.current)
          ? itemsAllFromAliasesRef.current.length
          : 0;
        const shouldClearAliases = hadAliases || snapshotCount > 0;
        if (shouldClearAliases) {
          await clearAliasesVerify(mac);
          mutableOps.aliases = true;
        }

        const shouldClearLocks =
          hadLocksForMac || (activeKssks?.length ?? 0) > 0 || hasSetup;
        if (shouldClearLocks) {
          let locksCleared = await clearKskLocksFully(mac);
          for (let i = 0; !locksCleared && i < 2; i++) {
            await sleep(250);
            locksCleared = await clearKskLocksFully(mac);
          }
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
          mutableOps.locks = locksCleared;
        }

        const messageParts: string[] = [];
        if (mutableOps.checkpoint) messageParts.push("checkpoint sent");
        if (mutableOps.aliases) messageParts.push("cache cleared");
        if (mutableOps.locks) messageParts.push("locks cleared");

        if (!messageParts.length) {
          setOkSystemNote("Nothing to clear");
        } else {
          const first = messageParts.shift() as string;
          const tail = messageParts.length
            ? `; ${messageParts.join("; ")}`
            : "";
          const note = `${first}${tail}`;
          setOkSystemNote(note.charAt(0).toUpperCase() + note.slice(1));
        }
      } finally {
        try {
          checkpointSentRef.current.clear();
        } catch {}
        try {
          xmlReadBlockUntilRef.current.set(mac, Date.now() + 60_000);
          recentCleanupRef.current.set(mac, Date.now());
          finalizeOkGuardRef.current.set(
            mac,
            Date.now() + Math.max(2000, cfgRetryCooldownMs)
          );
        } catch {}
        handleResetKfb();
      }
    },
    [
      cfgRetryCooldownMs,
      activeKssks,
      blockedMacRef,
      clearAliasesVerify,
      clearKskLocksFully,
      finalizeOkGuardRef,
      handleResetKfb,
      itemsAllFromAliasesRef,
      lastActiveIdsRef,
      lastFinalizedAtRef,
      lastFinalizedMacRef,
      lastRunHadFailuresRef,
      lastScanRef,
      recentCleanupRef,
      sendCheckpointForMac,
      setOkSystemNote,
      setSuppressLive,
      checkpointSentRef,
      xmlReadBlockUntilRef,
    ]
  );

  return { finalizeOkForMac, clearKskLocksFully };
};

export default useFinalize;
