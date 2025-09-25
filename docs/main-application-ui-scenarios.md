# MainApplicationUI — Scan & Live-Check README

> Production notes for the scan/check workflow that operators use to validate KFB/MAC devices, surface pin/contact issues in real time, and finalize healthy devices.

---

## Table of Contents

- [Overview](#overview)
- [Core Concepts](#core-concepts)
- [UI States](#ui-states)
- [Event & Action Glossary](#event--action-glossary)
- [End-to-End Flow (Mermaid)](#end-to-end-flow-mermaid)
- [Your Original Scenarios (Kept Verbatim)](#your-original-scenarios-kept-verbatim)
- [Clarified Scenario Guide (Same Logic, Clearer Wording)](#clarified-scenario-guide-same-logic-clearer-wording)
- [Live Mode Internals](#live-mode-internals)
- [Error & Retry Handling](#error--retry-handling)
- [Telemetry & Checkpoints](#telemetry--checkpoints)
- [Operational Notes](#operational-notes)
- [FAQ](#faq)

---

## Overview

**MainApplicationUI** orchestrates three big phases:

1. **Idle / Scan Prompt** — waiting for a scan or manual check command.
2. **Live Mode (when needed)** — real-time, operator-visible diagnostics for contacts/pins.
3. **Finalize / Reset** — send checkpoints, clear caches/locks, visually confirm OK, and return to idle.

The app automatically retries transient failures (e.g., 429/504/pending) and safeguards operator ergonomics by blocking rapid re-scans when no setup data exists for a scanned MAC/KFB.

---

## Core Concepts

- **MAC / KFB** — The device identifier being scanned/validated.
- **Aliases / Pins / Contacts** — Setup data that maps a device’s contacts to label names and expected states.
- **Branch Cards** — UI widgets that summarize per-branch status with badges: `OK`, `NOK`, or `Not Tested`.
- **KSKs (Keyed Session Keys)** — Active work items tied to the current device; finalized via **checkpoints**.
- **Redis Alias Cache** — Fast-lookup cache for setup aliases/pins per MAC; cleared on finalize and specific exits.
- **Live Mode** — Diagnostic mode to inspect pin status in real time (only when failures/unknown data are present).

---

## UI States

| State                        | When it Appears                                                 | Operator Signal                       |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------- |
| **IDLE / Scan Prompt**       | No active device; awaiting scan or manual check                 | “Scan MAC / Enter KFB” prompt visible |
| **LIVE (SCANNING/CHECKING)** | Failures/unknown pin data detected OR live inspection requested | Status pill `SCANNING` / `CHECKING`   |
| **Finalize OK**              | No failures, setup present                                      | Large **OK** SVG flash, quick reset   |
| **Auto-Retry**               | Transient errors: `429`, `504`, `pending`                       | Backoff indicator (non-blocking)      |
| **Prompt Another Attempt**   | Retries exhausted                                               | Clean slate; ask to re-scan           |

---

## Event & Action Glossary

- **Scan / Run Check** — Start of any cycle with a MAC/KFB.
- **No Setup Data** — The system can’t find aliases/pins for the given MAC → UI informs operator and idles.
- **Failures / Unknown Pins** — Triggers **Live Mode** so the operator can diagnose and monitor recovery.
- **All Pins Recover** — Live Mode shows a large **OK** and transitions to finalize/idle.
- **Finalize** — Sends checkpoints for active KSKs, clears caches/locks, flashes **OK**, returns to idle.
- **Auto-Retry** — Built-in backoff/retry for transient server-side or async states (429/504/pending).
- **Reset KFB Context** — Cleanup after exhausted retries; removes stale device/branch state.

---

## End-to-End Flow (Mermaid)

> **As requested:** keeping your first flow **exactly as provided previously**.

```mermaid
flowchart LR
    A[IDLE: Scan Prompt] -->|Scan/Run Check| B{Setup data present?}
    B -- No --> B1[UI: "No setup data for this MAC"\n• Clear scanned code\n• Briefly block retries] --> A

    B -- Yes --> C{Any failures or unknown pins?}
    C -- Yes --> D[Enter LIVE MODE]
    C -- No  --> E[Finalize (Live suppressed)\n• Send checkpoints for active KSKs\n• Clear Redis alias cache & KSK locks\n• Flash OK SVG] --> A

    %% Error path
    A -.->|Errors 429/504/Pending during scan| F[Auto-Retry Loop]
    F -->|Retry success| C
    F -->|Retries exhausted| G[Reset KFB context\nClear branch data\nPrompt another attempt] --> A
```
