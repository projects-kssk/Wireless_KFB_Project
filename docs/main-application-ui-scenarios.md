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
- [Clarified Scenario Guide](#clarified-scenario-guide)
- [Live Mode Internals](#live-mode-internals)
- [Error and Retry Handling](#error-and-retry-handling)
- [Telemetry and Checkpoints](#telemetry-and-checkpoints)
- [Operational Notes](#operational-notes)
- [FAQ](#faq)

---

## Overview

**MainApplicationUI** orchestrates three phases:

1. **Idle / Scan Prompt** — waiting for a scan or manual check command
2. **Live Mode (when needed)** — real-time, operator-visible diagnostics for contacts and pins
3. **Finalize / Reset** — send checkpoints, clear caches and locks, show OK, return to idle

Transient failures such as 429, 504, or pending are retried automatically. If a MAC or KFB has no setup data, the UI informs the operator, clears input, briefly blocks retries, and idles.

---

## Core Concepts

- **MAC / KFB** — Device identifier being scanned or validated
- **Aliases / Pins / Contacts** — Setup data mapping contacts to label names and expected states
- **Branch Cards** — UI widgets with per-branch badges: `OK`, `NOK`, `Not Tested`
- **KSKs (Keyed Session Keys)** — Active work items tied to the current device; finalized via **checkpoints**
- **Redis Alias Cache** — Fast lookup for setup aliases and pins per MAC; cleared on finalize and specific exits
- **Live Mode** — Diagnostic mode to inspect pin status in real time (only when failures or unknown data are present)

---

## UI States

| State                        | When it Appears                                                 | Operator Signal                  |
| ---------------------------- | --------------------------------------------------------------- | -------------------------------- |
| **IDLE / Scan Prompt**       | No active device; awaiting scan or manual check                 | Scan MAC or Enter KFB prompt     |
| **LIVE (SCANNING/CHECKING)** | Failures or unknown pins detected, or live inspection requested | Status pill SCANNING or CHECKING |
| **Finalize OK**              | No failures and setup present                                   | Large OK SVG flash, quick reset  |
| **Auto-Retry**               | Transient errors: 429, 504, pending                             | Backoff indicator                |
| **Prompt Another Attempt**   | Retries exhausted                                               | Clean slate; ask to re-scan      |

---

## Event & Action Glossary

- **Scan / Run Check** — Start of any cycle with a MAC or KFB
- **No Setup Data** — No aliases or pins found for MAC; UI informs operator and idles
- **Failures / Unknown Pins** — Triggers **Live Mode** for real-time diagnostics
- **All Pins Recover** — Live Mode shows large OK and transitions to finalize and idle
- **Finalize** — Send checkpoints for active KSKs, clear caches and locks, flash OK, return to idle
- **Auto-Retry** — Backoff and retry for 429, 504, or pending
- **Reset KFB Context** — Cleanup after exhausted retries; removes stale device and branch state

---

## End-to-End Flow (Mermaid)

> Same logic as your original first flow. Labels simplified for GitHub compatibility.

```mermaid
flowchart LR
  A[IDLE: Scan Prompt] -->|Scan or Run Check| B{Setup data present?}
  B -- No --> B1[No setup data for this MAC<br/>- Clear scanned code<br/>- Briefly block retries] --> A

  B -- Yes --> C{Any failures or unknown pins?}
  C -- Yes --> D[Enter LIVE MODE]
  C -- No  --> E[Finalize (live suppressed)]
  E --> E1[Send checkpoints for active KSKs]
  E1 --> E2[Clear Redis alias cache and KSK locks]
  E2 --> E3[Flash OK SVG]
  E3 --> A

  %% Error path
  A -.->|429 or 504 or Pending during scan| F[Auto-Retry Loop]
  F -->|Retry success| C
  F -->|Retries exhausted| G[Reset KFB context<br/>Clear branch data<br/>Prompt another attempt] --> A
```
