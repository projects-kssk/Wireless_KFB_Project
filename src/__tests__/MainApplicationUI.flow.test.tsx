import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../vitest.setup";

vi.mock("framer-motion", () => ({
  __esModule: true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  m: {
    div: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...rest}>{children}</div>
    ),
  },
}));

vi.mock("@/components/App/hooks/useConfig", () => ({
  __esModule: true,
  default: () => ({
    CFG: {
      CHECK_CLIENT_MS: 2000,
      RETRIES: 1,
      FINALIZED_RESCAN_BLOCK_MS: 0,
      RETRY_COOLDOWN_MS: 2000,
      OVERLAY_MS: 1500,
      STUCK_MS: 5000,
      OK_MS: 1200,
    },
    FLAGS: {
      REHYDRATE_ON_LOAD: false,
      USE_LOCKS: false,
      REHYDRATE_ON_RECOVERY: false,
      STATION_WARMUP: false,
      SCANNER_POLL: false,
      HINT_ON_EMPTY: false,
      CHECK_ON_EMPTY: false,
      SIMULATE: false,
    },
    ASSUME_REDIS_READY: true,
    ALLOW_IDLE_SCANS: true,
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

vi.mock("@/lib/macDisplay", () => ({
  __esModule: true,
  maskSimMac: (value: string) => value,
}));

let MainApplicationUI: React.ComponentType;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  server.resetHandlers();
  server.use(
    http.get("/api/aliases", ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.has("mac")) {
        return HttpResponse.json({ items: [] });
      }
      return HttpResponse.json({}, { status: 404 });
    })
  );
  const mod = await import("@/components/App/MainApplicationUI");
  MainApplicationUI = mod.default;
});

describe("MainApplicationUI flow (mocked scan)", () => {
  it("jeleníti az info üzenetet, ha a scan-hez nincs setup adat", async () => {
    render(<MainApplicationUI />);

    fireEvent.click(screen.getByTestId("mock-scanner-button"));

    expect(
      await screen.findByText("No setup data available for this MAC")
    ).toBeInTheDocument();
  });

  it("megjeleníti a hibát, ha a check visszaad pin hibákat", async () => {
    server.use(
      http.get("/api/aliases", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.has("mac")) {
          return HttpResponse.json({
            items: [
              {
                ksk: "KSK123",
                aliases: { "5": "PIN-5" },
                normalPins: [5],
              },
            ],
          });
        }
        return HttpResponse.json({}, { status: 404 });
      }),
      http.post("/api/serial/check", async () =>
        HttpResponse.json({ failures: [5] })
      )
    );

    render(<MainApplicationUI />);
    fireEvent.click(screen.getByTestId("mock-scanner-button"));

    expect(await screen.findByText("1 failure")).toBeInTheDocument();
  });
});
