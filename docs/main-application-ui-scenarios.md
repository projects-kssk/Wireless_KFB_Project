# MainApplicationUI Scan Scenarios

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 90, 'rankSpacing': 140}, 'themeVariables': {'fontSize': '18px'}}}%%
flowchart LR
    A[IDLE: Scan Prompt] --> S[Scanner ACM0 event]
    S -->|Run check may retrigger| B{Setup data present?}
    B -- No --> B1[Show no setup data banner\nClear scanned code\nReady for immediate retry] --> A

    B -- Yes --> C{Failures or unknown pins?}

    %% Live-mode branch
    C -- Yes --> LM0
    subgraph Live_Mode [LIVE MODE]
        direction TB
        LM0[Enter live view]
        LM1[Render status pill]
        LM2[Display branch cards]
        LM3[Highlight pending failures]
        LM4[Stream serial edges]
        LM0 --> LM1 --> LM2 --> LM3 --> LM4
        LM4 -->|Pins still failing| LM2
    end
    LM4 -->|All pins recovered| F0

    %% Finalize path when setup ready and no failures
    C -- No --> F0

    subgraph Finalize_Cleanup [FINALIZE & CLEANUP]
        direction LR
        F0[Begin finalize sequence] --> F1[Send checkpoints for active KSKs]
        F1 --> F2[Clear Redis alias cache]
        F2 --> F3[Clear KSK locks]
        F3 --> F4[Flash OK SVG]
        F4 --> F5[Reset UI to IDLE]
    end
    F5 --> A

    %% Error path
    A -.->|Errors 429 504 Pending during scan| R0[Auto-retry loop]
    R0 -->|Retry success| R1[Re-run check]
    R1 --> C
    R0 -->|Retries exhausted| R2[Reset KFB context\nClear branch data\nShow retry prompt]
    R2 --> A
```

1. INPUT: Scan or run check for a MAC/KFB without any setup aliases/pins -> OUTPUT: UI shows `No setup data available for this MAC`, clears the scanned code, and returns to IDLE so the operator can retry immediately.
2. INPUT: Scan or run check returns failures/unknown pin data -> OUTPUT: Live mode stays active, streaming real-time pin edges with contact labels and a pending-failures list until all errors clear; once recovered it falls through to the finalize sequence.
   2.1 INPUT: BranchDashboardMainContent enters live mode with active MAC -> OUTPUT: Renders status pill (`SCANNING`/`CHECKING`), builds branch cards with OK/NOK/Not Tested badges, highlights pending pins, flashes a large OK SVG once the pins recover, pushes checkpoints for active KSKs, clears Redis aliases and locks, shows the cleanup note, then returns to the scan prompt.
3. INPUT: Scan or run check finishes with no failures and setup data present -> OUTPUT: Finalize sequence runs (checkpoints → alias purge → lock clear), flashes the OK SVG, surfaces the cleanup note, and resets the UI for the next device.
4. INPUT: Scan or run check hits errors like 429/504/pending -> OUTPUT: Scheduler queues bounded retries (default 350 ms backoff); any successful retry drops back into the normal flow, while exhausting the retry budget disables the OK flash, clears branch/alias state, resets the KFB context to IDLE, and surfaces a retry prompt so the operator must rescan.

## Additional Diagrams

### Setup Page Flow (ACM1)

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 85, 'rankSpacing': 130}, 'themeVariables': {'fontSize': '17px'}}}%%
flowchart LR
    S0[Setup idle] --> S1[Acquire scan scope setup]
    S1 --> S2[Scanner ACM1 event or manual input]
    S2 --> T{Classify code}

    T -- KFB MAC --> K0[Set board MAC and setup name]
    K0 --> K1[Reset KSK slots to idle]
    K1 --> K2[Start 60s countdown update TableSwap header]
    K2 --> S0

    T -- KSK serial --> P0[Pre checks board scanned duplicates capacity]
    P0 -- fail --> PF[Show panel error keep slot idle] --> S0
    P0 -- ok --> P1[Mark slot pending]
    P1 --> P2[POST ksk lock]
    P2 -- failure --> P3[Revert slot show error] --> S0
    P2 -- success --> P4[Add lock start heartbeat]
    P4 --> P5[Load aliases prefer Redis fallback Krosy]
    P5 -- failure --> P6[Mark slot error toast message] --> S0
    P5 -- success --> P7[Persist pin map update slot OK]
    P7 --> P8[Trigger TableSwap flash increment cycle]
    P8 --> P9[If three OK schedule auto reset]
    P9 --> S0

    T -- Unknown --> U0[Show unrecognized code error] --> S0
```

### LIVE Mode Internals (Scenario 2.1)

```mermaid
flowchart TB
    L0[Live mode enter with active MAC] --> L1[Render status pill SCANNING or CHECKING]
    L1 --> L2[Build branch cards with OK or NOK or Not Tested]
    L2 --> L3[Show contact label names and pin states in real time]
    L3 --> L4[Highlight pending failures list and pin numbers]
    L4 --> L5[Stream live edges from serial events]
    L5 -->|Pins still failing| L3
    L5 -->|All pins recover| L6[Flash large OK SVG]
    L6 --> L7[Push checkpoints for active KSKs]
    L7 --> L8[Bulk delete Redis alias cache for MAC]
    L8 --> L9[Clear KSK locks from Redis]
    L9 --> L10[Display cleanup note checkpoint cache locks]
    L10 --> L11[Return to scan prompt IDLE]
```

### Error and Retry Handling (Scenario 4)

```mermaid
flowchart TB
    R0[Scan or run check] --> R1{HTTP response}
    R1 -- 200 OK --> R3[Process result payload]
    R1 -- 429 Too Many Requests --> R2[Schedule retry 350ms]
    R1 -- 504 Gateway Timeout --> R2
    R1 -- Pending or No Result --> R2
    R2 -->|Attempts remaining| R0
    R2 -->|Attempts exhausted| R4[Disable OK animation & reset KFB]
    R4 --> R5[Clear branch data and name hints]
    R5 --> R6[Prompt operator to rescan] --> R7[IDLE]
```

### TableSwap Flow

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 80, 'rankSpacing': 120}, 'themeVariables': {'fontSize': '16px'}}}%%
flowchart TB
    T0[TableSwap prompt idle] -->|Board MAC scanned| T1[Set board context title]
    T1 -->|Cycle key bump| T2[Animate slide to new header]
    T2 --> T3[Show progress prompt]
    T3 -->|Slot pending| T4[Highlight slot pending]
    T4 --> T5{Lock and alias success}
    T5 -- no --> T6[Flash error overlay keep slot retry]
    T6 --> T3
    T5 -- yes --> T7[Flash success overlay]
    T7 --> T8[Slot marked OK heartbeat running]
    T8 -->|All slots cleared or auto reset| T0
```

### TableSwap Flow

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 80, 'rankSpacing': 120}, 'themeVariables': {'fontSize': '16px'}}}%%
flowchart TB
    T0[TableSwap prompt idle] -->|Board MAC scanned| T1[Set board context title]
    T1 -->|cycle key bump| T2[Animate slide to new header]
    T2 --> T3[Show progress prompt]
    T3 -->|Slot pending| T4[Highlight slot pending]
    T4 --> T5{Lock and alias success}
    T5 -- no --> T6[Flash error overlay keep slot retry]
    T6 --> T3
    T5 -- yes --> T7[Flash success overlay]
    T7 --> T8[Slot marked OK heartbeat running]
    T8 -->|All slots cleared or auto reset| T0
```
