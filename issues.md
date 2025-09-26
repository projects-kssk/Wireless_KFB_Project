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
