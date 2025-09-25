# MainApplicationUI Scan Scenarios

```mermaid
flowchart LR
    A[IDLE: Scan Prompt] -->|Scan or Run Check| B{Setup data present?}
    B -- No --> B1[No setup data for this MAC<br/>Clear scanned code<br/>Allow immediate retry] --> A

    B -- Yes --> C{Any failures or unknown pins?}
    C -- Yes --> D[Enter LIVE MODE]
    D --> D1[Live monitoring: status pill and branch cards]
    D1 --> D2{All pins recovered?}
    D2 -- No --> D1
    D2 -- Yes --> E[Finalize live suppressed]
    E --> E1[Send checkpoints for active KSKs]
    E1 --> E2[Clear Redis alias cache]
    E2 --> E3[Clear KSK locks]
    E3 --> E4[Flash OK SVG]
    E4 --> E5[Reset UI to IDLE]
    E5 --> A

    %% Error path
    A -.->|Errors 429 504 Pending during scan| F[Auto-Retry Loop]
    F -->|Retry success| H[Re-run check with updated attempts]
    H --> C
    F -->|Retries exhausted| G[Reset KFB context<br/>Clear branch data<br/>Show retry prompt] --> A
```

1. INPUT: Scan or run check for a MAC/KFB without any setup aliases/pins -> OUTPUT: UI shows `No setup data available for this MAC`, clears the scanned code, and returns to IDLE so the operator can retry immediately.
2. INPUT: Scan or run check returns failures/unknown pin data -> OUTPUT: Live mode stays active, streaming real-time pin edges with contact labels and a pending-failures list until all errors clear; once recovered it falls through to the finalize sequence.
2.1 INPUT: BranchDashboardMainContent enters live mode with active MAC -> OUTPUT: Renders status pill (`SCANNING`/`CHECKING`), builds branch cards with OK/NOK/Not Tested badges, highlights pending pins, flashes a large OK SVG once the pins recover, pushes checkpoints for active KSKs, clears Redis aliases and locks, shows the cleanup note, then returns to the scan prompt.
3. INPUT: Scan or run check finishes with no failures and setup data present -> OUTPUT: Finalize sequence runs (checkpoints → alias purge → lock clear), flashes the OK SVG, surfaces the cleanup note, and resets the UI for the next device.
4. INPUT: Scan or run check hits errors like 429/504/pending -> OUTPUT: Flow auto-retries with scheduled backoff; if retries succeed it rejoins the normal flow, otherwise it disables the OK animation, resets the KFB context, clears branch data, and prompts another attempt.

## Additional Diagrams

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
    L9 --> L10[Show cleanup note checkpoint cache locks]
    L10 --> L11[Return to scan prompt IDLE]
```

### Error and Retry Handling (Scenario 4)

```mermaid
flowchart TB
    R0[Scan or run check] --> R1{HTTP response}
    R1 -- 200 OK --> R3[Process result payload]
    R1 -- 429 Too Many Requests --> R2[Schedule retry (350ms)]
    R1 -- 504 Gateway Timeout --> R2
    R1 -- Pending/No Result --> R2
    R2 -->|Attempts remaining| R0
    R2 -->|Attempts exhausted| R4[Disable OK animation & reset KFB]
    R4 --> R5[Clear branch data and name hints]
    R5 --> R6[Prompt operator to rescan] --> R7[IDLE]
```
