SDK BRIDGE READY

Tujuan:
- Menjembatani Node.js webserver dengan SDK resmi ZKTeco/Finger Solution .NET/C++.
- Dipakai untuk command remote enroll trigger.

Nama file default:
bridge\ZkEnrollBridge.exe

Command yang harus didukung:

1. Cek support:
ZkEnrollBridge.exe check --ip 192.168.18.200 --port 4370 --sn SERIAL

2. Mulai enroll:
ZkEnrollBridge.exe enroll --ip 192.168.18.200 --port 4370 --sn SERIAL --user 1001 --finger 1

Output JSON:
{"ok":true,"message":"Enroll command sent","method":"StartEnroll"}

Jika gagal:
{"ok":false,"error":"Device does not support remote enroll"}

Catatan:
- File EXE ini belum berisi SDK vendor.
- Masukkan SDK resmi ZKTeco/Finger Solution ke project bridge nanti.
