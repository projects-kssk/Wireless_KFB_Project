] POST /api/checkpoint 200 in 5ms
[NEXT] POST /api/visualcontrol 200 in 7ms
[NEXT] POST /api/visualcontrol 200 in 5ms
[NEXT] POST /api/visualcontrol 200 in 13ms
[NEXT] POST /api/checkpoint 200 in 6ms
[NEXT] POST /api/checkpoint 200 in 6ms
[NEXT] POST /api/checkpoint 200 in 6ms
[NEXT] POST /api/checkpoint 200 in 4ms

FOR CHECKPOINT? always one more checkpoint call sent??
check for two or 1 ksk too if there is more checkpoint request than the actuall ksk

the finalize on the live mode doesnt work, doesnt send checkpoint or clear the redis and the ksk locks.
THe other finalze is correct

EXT] [events] EV DONE {
[NEXT] ok: false,
[NEXT] mac: '08:3A:8D:15:27:54',
[NEXT] line: '← reply from 08:3A:8D:15:27:54: RESULT FAILURE MISSING 14'
[NEXT] }
[NEXT] [events] EV DONE {
[NEXT] ok: false,
[NEXT] mac: '08:3A:8D:15:27:54',
[NEXT] line: '← reply from 08:3A:8D:15:27:54: RESULT FAILURE MISSING 14'
[NEXT] }
[NEXT] [events] EV DONE {
[NEXT] ok: false,
[NEXT] mac: '08:3A:8D:15:27:54',
[NEXT] line: '← reply from 08:3A:8D:15:27:54: RESULT FAILURE MISSING 14'
[NEXT] }
[NEXT] [monitor] CHECK rx mac=08:3A:8D:15:27:54 raw="← reply from 08:3A:8D:15:27:54: RESULT FAILURE MISSING 14"
[NEXT] [api:serial/check] CHECK failure
[NEXT] [monitor] CHECK fail mac=08:3A:8D:15:27:54 failures=[14] durMs=216
[NEXT] POST /api/serial/check 200 in 519ms
[NEXT] [ksk-lock] GET list
[NEXT] GET /api/ksk-lock?stationId=JETSON-01 200 in 8ms
[NEXT] [ksk-lock] GET list
[NEXT] GET /api/ksk-lock?stationId=JETSON-01 200 in 7ms
[NEXT] [ksk-lock] GET list
[NEXT] GET /api/ksk-lock?stationId=JETSON-01 200 in 9ms
[NEXT] [ksk-lock] GET list
[NEXT] GET /api/ksk-lock?stationId=JETSON-01 200 in 8ms
[NEXT] [ksk-lock] GET list
[NEXT] GET /api/ksk-lock?stationId=JETSON-01 200 in 8ms
[NEXT] [ksk-lock] GET list
[NEXT] GET /api/ksk-lock?stationId=JETSON-01 200 in 9ms
[NEXT] [ksk-lock] GET list
[NEXT] GET /api/ksk-lock?stationId=JETSON-01 200 in 9ms
[NEXT] [ksk-lock] GET list
[NEXT] GET /api/ksk-lock?stationId=JETSON-01 200 in 9ms
[NEXT] [ksk-lock] GET list
[NEXT] GET /api/ksk-lock?stationId=JETSON-01 200 in 8ms
[NEXT] [events] EV {
[NEXT] kind: 'P',
[NEXT] ch: 14,
[NEXT] val: 1,
[NEXT] mac: '08:3A:8D:15:27:54',
[NEXT] line: 'EV P 14 1 08:3A:8D:15:27:54'
[NEXT] }
[NEXT] [events] EV {
[NEXT] kind: 'P',
[NEXT] ch: 14,
[NEXT] val: 1,
[NEXT] mac: '08:3A:8D:15:27:54',
[NEXT] line: 'EV P 14 1 08:3A:8D:15:27:54'
[NEXT] }
[NEXT] [events] EV {
[NEXT] kind: 'P',
[NEXT] ch: 14,
[NEXT] val: 1,
[NEXT] mac: '08:3A:8D:15:27:54',
[NEXT] line: 'EV P 14 1 08:3A:8D:15:27:54'
[NEXT] }
[NEXT] POST /api/simulate 200 in 12ms

still the old cl falsses before we shwo the union new design - Branchdashboardmaincontet

FINALIZE:
NEXT] ✓ Compiled /api/serial/check in 429ms (1547 modules)
[NEXT] [monitor] CHECK kssk targets count=1 station=JETSON-01
[NEXT] [monitor] CHECK union pins count=1
[NEXT] [api:serial/check] CHECK begin
[NEXT] [monitor] CHECK start mac=08:3A:8D:15:27:54 mode=merge pins=1
[NEXT] [monitor] CHECK espPath=/dev/ttyUSB0
[NEXT] [monitor] CHECK send mac=08:3A:8D:15:27:54 cmd='CHECK 14 08:3A:8D:15:27:54'
[NEXT] [events] EV DONE {
[NEXT] ok: true,
[NEXT] mac: '08:3A:8D:15:27:54',
[NEXT] line: '← reply from 08:3A:8D:15:27:54: RESULT SUCCESS'
[NEXT] }
[NEXT] [events] EV DONE {
[NEXT] ok: true,
[NEXT] mac: '08:3A:8D:15:27:54',
[NEXT] line: '← reply from 08:3A:8D:15:27:54: RESULT SUCCESS'
[NEXT] }
[NEXT] [events] EV DONE {
[NEXT] ok: true,
[NEXT] mac: '08:3A:8D:15:27:54',
[NEXT] line: '← reply from 08:3A:8D:15:27:54: RESULT SUCCESS'
[NEXT] }
[NEXT] [monitor] CHECK rx mac=08:3A:8D:15:27:54 raw="← reply from 08:3A:8D:15:27:54: RESULT SUCCESS"
[NEXT] [api:serial/check] CHECK success
[NEXT] [monitor] CHECK ok mac=08:3A:8D:15:27:54 failures=0 durMs=220
[NEXT] POST /api/serial/check 200 in 719ms
[NEXT] GET /api/serial/events?mac=08%3A3A%3A8D%3A15%3A27%3A54 200 in 761ms
[NEXT] ✓ Compiled /api/krosy-offline/checkpoint in 443ms (1549 modules)
[NEXT] [aliases] GET aliases
[NEXT] [aliases] GET aliases items
[NEXT] GET /api/aliases?mac=08%3A3A%3A8D%3A15%3A27%3A54&all=1 200 in 489ms
[NEXT] POST /api/krosy-offline/checkpoint 200 in 520ms
[NEXT] ✓ Compiled /api/aliases/xml in 205ms (1551 modules)
[NEXT] [aliases:xml] aliases xml read
[NEXT] GET /api/aliases/xml?mac=08%3A3A%3A8D%3A15%3A27%3A54&kssk=830577903926 200 in 254ms
[NEXT] POST /api/krosy-offline/checkpoint 200 in 35ms
[NEXT] ✓ Compiled /api/aliases/clear in 407ms (1553 modules)
[NEXT] [ksk-lock] GET list (empty)
[NEXT] GET /api/ksk-lock?stationId=JETSON-01 200 in 317ms
[NEXT] [aliases:clear] cleared aliases
[NEXT] POST /api/aliases/clear 200 in 458ms
[NEXT] [aliases] GET aliases
[NEXT] [aliases] GET aliases items
[NEXT] GET /api/aliases?mac=08%3A3A%3A8D%3A15%3A27%3A54&all=1 200 in 15ms
[NEXT] [ksk-lock] DELETE bulk mac (scan)
[NEXT] DELETE /api/ksk-lock?mac=08%3A3A%3A8D%3A15%3A27%3A54&force=1 200 in 10ms
[NEXT] [ksk-lock] GET list (empty)
[NEXT] GET /api/ksk-lock 200 in 10ms
[NEXT] [ksk-lock] DELETE bulk mac (scan)
[NEXT] DELETE /api/ksk-lock 200 in 8ms
[NEXT] [ksk-lock] GET list (empty)
