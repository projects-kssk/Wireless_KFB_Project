curl -sS -X POST http://localhost:3000/api/krosy \
  -H "content-type: application/json" \
  -d '{
    "action": "working",
    "intksk": "830577899396",
    "requestID": "1",
    "sourceHostname": "ksskkfb01",
    "targetHostName": "kssksun01",
    "targetAddress": "192.20.10.1"
  }'

nc -vz 192.20.10.1 10080   # or: Test-NetConnection 192.20.10.1 -Port 10080


curl -i -X OPTIONS http://localhost:3000/api/krosy \
  -H 'Origin: http://172.26.202.248:3000' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,accept'
