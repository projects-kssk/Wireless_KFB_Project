import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runCheckMock = vi.fn();
const loadBranchesDataMock = vi.fn();
const handleScanMock = vi.fn();
const finalizeOkForMacMock = vi.fn();
const clearKskLocksFullyMock = vi.fn();

vi.mock("@/components/App/hooks/useConfig", () => ({
  __esModule: true,
  default: () => ({
    CFG: {
      CHECK_CLIENT_MS: 2000,
      RETRIES: 2,
      FINALIZED_RESCAN_BLOCK_MS: 500,
      RETRY_COOLDOWN_MS: 300,
    },
    FLAGS: {
      REHYDRATE_ON_LOAD: false,
      USE_LOCKS: true,
      SIM_AUTORUN: false,
    },
    ASSUME_REDIS_READY: true,
  }),
}));

vi.mock("@/components/App/hooks/useTimers", () => {
  const schedule = vi.fn();
  const cancel = vi.fn();
  return {
    __esModule: true,
    default: () => ({ schedule, cancel }),
    useTimers: () => ({ schedule, cancel }),
  };
});

vi.mock("@/components/App/hooks/useHud", () => ({
  __esModule: true,
  default: () => ({
    hudMode: "idle",
    hudMessage: "Készen áll",
    hudSubMessage: undefined,
    scannerDetected: true,
  }),
}));

vi.mock("@/components/App/hooks/useSerialLive", () => ({
  __esModule: true,
  default: () => ({
    serial: {
      scannersDetected: 1,
      sseConnected: true,
      lastScanTick: 0,
    },
    redisReadyRef: { current: true },
  }),
}));

vi.mock("@/components/App/hooks/useFinalize", () => ({
  __esModule: true,
  default: () => ({
    finalizeOkForMac: finalizeOkForMacMock,
    clearKskLocksFully: clearKskLocksFullyMock,
  }),
}));

vi.mock("@/components/App/hooks/useScanFlow", () => ({
  __esModule: true,
  default: () => ({
    runCheck: runCheckMock,
    loadBranchesData: loadBranchesDataMock,
    handleScan: handleScanMock,
  }),
}));

vi.mock("@/components/Header/Header", () => ({
  __esModule: true,
  Header: () => <div data-testid="header">Mock Header</div>,
}));

vi.mock("@/components/Program/BranchDashboardMainContent", () => ({
  __esModule: true,
  default: () => <div data-testid="dashboard-content">Mock Dashboard</div>,
}));

vi.mock("@/lib/scanScope", () => ({
  __esModule: true,
  readScanScope: () => false,
  subscribeScanScope: (_key: string, cb: (value: boolean) => void) => {
    cb(false);
    return () => {};
  },
}));

vi.mock("@/components/App/components/UnionEffect", () => ({
  __esModule: true,
  UnionEffect: () => null,
  default: () => null,
}));

vi.mock("@/components/App/components/AutoFinalizeEffect", () => ({
  __esModule: true,
  AutoFinalizeEffect: () => null,
  default: () => null,
}));

vi.mock("@/components/App/components/DeviceEventsEffect", () => ({
  __esModule: true,
  DeviceEventsEffect: () => null,
  default: () => null,
}));

vi.mock("@/components/App/components/PollingEffect", () => ({
  __esModule: true,
  PollingEffect: () => null,
  default: () => null,
}));

vi.mock("@/components/App/components/PostResetSanityEffect", () => ({
  __esModule: true,
  PostResetSanityEffect: () => null,
  default: () => null,
}));

vi.mock("@/components/App/components/RedisHealthEffect", () => ({
  __esModule: true,
  RedisHealthEffect: () => null,
  default: () => null,
}));

vi.mock("@/components/App/components/ScannerEffect", () => ({
  __esModule: true,
  ScannerEffect: ({ handleScan }: { handleScan: (code: string, trigger: "sse") => void }) => (
    <button
      type="button"
      data-testid="mock-scanner-button"
      onClick={() => handleScan("AA:BB:CC:DD:EE:FF", "sse")}
    >
      Trigger mock scan
    </button>
  ),
  default: ({ handleScan }: { handleScan: (code: string, trigger: "sse") => void }) => (
    <button
      type="button"
      data-testid="mock-scanner-button"
      onClick={() => handleScan("AA:BB:CC:DD:EE:FF", "sse")}
    >
      Trigger mock scan
    </button>
  ),
}));

vi.mock("@/components/App/utils/merge", () => ({
  __esModule: true,
  computeActivePins: () => ({ normal: [], latch: [] }),
}));

vi.mock("@/components/App/utils/paths", () => ({
  __esModule: true,
  isAcmPath: () => true,
  pathsEqual: () => true,
  resolveDesiredPath: () => null,
}));

vi.mock("@/components/App/utils/mac", () => ({
  __esModule: true,
  canonicalMac: (mac: string) => mac.toUpperCase(),
  MAC_ONLY_REGEX: /^[0-9A-F:]+$/,
  macKey: (mac: string) => mac.toUpperCase(),
}));

vi.mock("@/lib/macDisplay", () => ({
  __esModule: true,
  maskSimMac: (value: string) => value,
}));

let MainApplicationUI: React.ComponentType;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import("@/components/App/MainApplicationUI");
  MainApplicationUI = mod.default;
});

describe("MainApplicationUI mock flow", () => {
  it("delegates scan handling via mocked ScannerEffect", async () => {
    render(<MainApplicationUI />);

    const button = screen.getByTestId("mock-scanner-button");
    fireEvent.click(button);

    expect(handleScanMock).toHaveBeenCalledWith("AA:BB:CC:DD:EE:FF", "sse");
    expect(runCheckMock).not.toHaveBeenCalled();
    expect(finalizeOkForMacMock).not.toHaveBeenCalled();
  });
});
