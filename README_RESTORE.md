Server.js sudah diubah untuk menambah:
- Endpoint /api/register, /api/login, /api/delete-account (storage JSON)
- Room default 'default' untuk realtime
- Event auth (client emit 'auth')
- Event battery-update (broadcast battery-status)
- Payload lokasi: lat,lng,accuracy,speed,roadName

Jika terjadi error syntax saat start server, cek apakah file server.js memiliki newline EOF dan tidak terpotong.
