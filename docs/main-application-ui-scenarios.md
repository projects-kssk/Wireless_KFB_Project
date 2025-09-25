# MainApplicationUI Scan Scenarios

```mermaid
flowchart LR
    A[IDLE: Scan Prompt] -->|Scan or Run Check| B{Setup data present?}
    B -- No --> B1[No setup data for this MAC<br/>Clear scanned code<br/>Briefly block retries] --> A

    B -- Yes --> C{Any failures or unknown pins?}
    C -- Yes --> D[Enter LIVE MODE]
    C -- No --> E[Finalize live suppressed]
    E --> E1[Send checkpoints]
    E1 --> E2[Clear Redis alias cache and KSK locks]
    E2 --> E3[Flash OK SVG]
    E3 --> A

    %% Error path
    A -.->|Errors 429 504 Pending during scan| F[Auto-Retry Loop]
    F -->|Retry success| C
    F -->|Retries exhausted| G[Reset KFB context<br/>Clear branch data<br/>Prompt another attempt] --> A
```

1. INPUT: Scan or run check for a MAC/KFB without any setup aliases/pins -> OUTPUT: UI shows `No setup data available for this MAC`, clears the scanned code, blocks retries briefly, and idles.
2. INPUT: Scan or run check returns failures/unknown pin data -> OUTPUT: Live mode stays active, showing contact label names and pin statuses so the operator can inspect issues in real time.
2.1 INPUT: BranchDashboardMainContent enters live mode with active MAC -> OUTPUT: Renders status pill (`SCANNING`/`CHECKING`), builds branch cards with OK/NOK/Not Tested badges, highlights pending failures list, flashes large OK SVG when all pins recover, pushes checkpoints for the active KSKs, bulk-deletes the Redis alias cache entries for that MAC, clears the KSK locks, then returns to the scan prompt idle view.
3. INPUT: Scan or run check finishes with no failures and setup data present -> OUTPUT: Live mode is suppressed, finalize sends checkpoints for the active KSKs, clears the Redis alias cache and KSK locks, flashes the OK SVG confirmation, and then resets the UI for the next device.
4. INPUT: Scan or run check hits errors like 429/504/pending -> OUTPUT: Flow retries automatically; after retries are exhausted it resets the KFB context, clears branch data, and prompts another attempt.

## Additional Diagrams

### LIVE Mode Internals (Scenario 2.1)

```mermaid
flowchart TB
    L0[Live mode enter with active MAC] --> L1[Render status pill SCANNING or CHECKING]
    L1 --> L2[Build branch cards with OK or NOK or Not Tested]
    L2 --> L3[Show contact label names and pin states]
    L3 --> L4[Highlight pending failures list]
    L4 -->|All pins recover| L5[Flash large OK SVG]
    L5 --> L6[Push checkpoints for active KSKs]
    L6 --> L7[Bulk delete Redis alias cache for MAC]
    L7 --> L8[Clear KSK locks]
    L8 --> L9[Return to scan prompt IDLE]
```

### Error and Retry Handling (Scenario 4)

```mermaid
flowchart TB
    R0[Scan or run check] --> R1{Result}
    R1 -- 429 or 504 or Pending --> R2[Backoff and auto retry]
    R2 -->|Retry OK| R3[Continue normal flow<br/>Live mode or finalize]
    R2 -->|Retry exhausted| R4[Reset KFB context<br/>Clear branch data]
    R4 --> R5[Prompt user for another attempt] --> R6[IDLE]
```
