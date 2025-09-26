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
