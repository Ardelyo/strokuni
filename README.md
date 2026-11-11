# Strokuni

Aplikasi Android dan web untuk **Lio**, pasien pasca stroke. Strokuni menyatukan tiga hal:

- **Pengingat obat layar penuh** dengan kunci dosis ganda dan eskalasi ke keluarga
- **Latihan huruf dan keyboard**: menelusuri huruf, mencari tombol, dan menulis kata dari keluarga
- **Catatan malam** ("otak kedua") yang disusun AI lalu disetujui keluarga

> Ini uji coba keluarga, **bukan alat medis**. Jadwal dan dosis obat hanya ditetapkan keluarga dari resep dokter. AI tidak pernah menentukan atau mengubah obat atau dosis. Keputusan klinis tetap pada dokter dan terapis.

Konsep lengkap: [docs/KONSEP.md](docs/KONSEP.md)

## Cara memakai

| Bentuk | Cara mendapatkan |
| --- | --- |
| **APK Android** | Unduh `strokuni.apk` dari [Releases → latest](../../releases/tag/latest). Dibangun otomatis oleh GitHub Actions di setiap commit ke `main`. |
| **Web** | Buka GitHub Pages proyek ini. Tambahkan `?demo` di URL untuk mencoba dengan data contoh (PIN keluarga demo: `1234`). Bisa dipasang sebagai PWA. |
| **Server AI** | Folder [`server/`](server/). Opsional: tanpa server, aplikasi tetap jalan dan membuat ringkasan malam standar tanpa AI. |

### Memasang APK (dikerjakan keluarga, sekali)

1. Unduh `strokuni.apk` di HP Lio, buka, izinkan "pasang dari sumber tidak dikenal" untuk satu aplikasi itu.
2. Buka Strokuni, isi profil, buat PIN keluarga, pilih "HP Lio".
3. Ikuti **Panduan izin** (sekitar 15 menit): notifikasi, alarm & pengingat, layar penuh, abaikan optimasi baterai, mulai otomatis (menu tiap merek HP berbeda), mikrofon, kamera, telepon.
4. Tekan **Tes alarm**, kunci layar, dan pastikan layar obat menyala sendiri.
5. Tambahkan obat dari resep di tab **Obat**.
6. Selama masa uji, tetap pasang **alarm bawaan HP** pada jam obat sebagai cadangan.

## Dua mode

**Mode Lio**: satu kartu "Sekarang" pada satu waktu. Urutan prioritas: obat → istirahat (bila lelah) → catatan malam → tugas berikutnya → selesai. Semua petunjuk dibacakan, tombol besar (≥ 56 px, utama 88 px), selalu ada tombol **Telepon** keluarga dan **Saya lelah**.

**Mode Keluarga** (dikunci PIN): beranda harian, persetujuan catatan malam, jadwal obat (dengan foto label yang dibaca AI sebagai draf), daftar kata, lama sesi, rencana, pengaturan, panduan izin.

## Arsitektur

```
HP Lio (APK)                     Server perantara (server/)          HP Keluarga (APK/web)
┌───────────────────────┐        ┌──────────────────────────┐        ┌────────────────────┐
│ Web app (www/)         │  log   │ • kunci API hanya di sini │ draf   │ Mode Keluarga      │
│  Mode Lio, latihan     ├───────►│ • instruksi tetap + skema ├───────►│ setujui / ubah     │
│ Kotlin native          │        │ • validasi + penjaga obat │        │                    │
│  setAlarmClock         │◄───────┤ • batas panggilan/hari    │◄───────┤ rencana disetujui  │
│  layar penuh, boot     │ rencana│ • peringatan & heartbeat  │        │ peringatan keras   │
└───────────────────────┘        └────────────┬─────────────┘        └────────────────────┘
                                              │ Vertex AI (Gemini) + Firestore
```

- **www/**: aplikasi web tanpa langkah build (HTML/CSS/ES modules), desain Material Design 3 buatan sendiri, offline lewat service worker, ikon Material Symbols dibundel.
- **android/**: proyek Capacitor 8. Jalur kritis ditulis native di Kotlin (`android/app/src/main/java/id/strokuni/app/`):
  - `AlarmScheduler.kt`: `setAlarmClock` untuk jadwal obat, follow-up eskalasi tiap N menit
  - `MedAlarmActivity.kt`: layar obat di atas kunci layar (`setShowWhenLocked`, `setTurnScreenOn`), TTS, kunci dosis ganda, tombol telepon
  - `BootReceiver.kt`: memulihkan alarm setelah restart, update, atau ganti jam
  - `HeartbeatWorker.kt`: sinyal "masih hidup" tiap 15 menit; di HP keluarga mengecek peringatan
  - `StrokuniPlugin.kt`: jembatan JS (jadwal, status izin, TTS, dikte, telepon)
- **server/**: Node 22 di Cloud Run, AI **Gemini lewat Vertex AI** (`gemini-3.8-flash`, cadangan `gemini-3.5-flash-lite`), data di **Firestore**. Keluaran AI memakai response schema, divalidasi ulang dengan zod, dan ditolak bila menyebut perubahan obat.

### Tiga lapis agar pengingat tidak hilang

1. `AlarmManager.setAlarmClock` (paling andal saat mode hemat daya) + notifikasi full-screen intent.
2. Sinyal "masih hidup" ke server; bila berhenti > 3 jam, HP keluarga diberi peringatan.
3. Alarm bawaan HP sebagai cadangan selama masa uji.

### Eskalasi obat

| Waktu sejak jadwal | Yang terjadi |
| --- | --- |
| 0 menit | Layar penuh menyala, suara tenang membacakan nama obat |
| tiap 10 menit | Pengingat ulang bersuara |
| 30 menit | HP keluarga menerima peringatan keras (butuh server) |
| 60 menit | Layar Lio menampilkan tombol besar "Telepon" keluarga, dengan teks "Jangan minum dua kali" |

Semua angka bisa diatur di Mode Keluarga → Lainnya.

## Menjalankan secara lokal

```bash
npm install
npm run dev            # web di http://localhost:5173  (tambahkan ?demo)
node scripts/check.mjs # cek semua import modul
```

Server (lokal, tanpa GCP: AI mati dan data di file JSON):

```bash
cd server
npm install
cp .env.example .env   # isi FAMILY_CODES; kosongkan GOOGLE_CLOUD_PROJECT bila tanpa AI
node --env-file=.env index.mjs
npm test
```

Lalu di aplikasi: Mode Keluarga → Lainnya → Server: isi alamat server dan kode keluarga yang sama di semua HP.

### Server di Google Cloud (project `gemma4good-494311`)

```bash
cd server
bash deploy-gcp.sh
```

Server yang sudah berjalan: `https://strokuni-server-pgku264xda-et.a.run.app` (alamat ini sudah jadi isian bawaan di aplikasi; kode keluarga diisi manual di Lainnya → Server).

Skrip membuat resource baru saja: service account `strokuni-server` (hanya peran Vertex AI User dan Datastore User), database Firestore `strokuni` (Jakarta), secret `strokuni-family-codes`, dan Cloud Run `strokuni-server`. Layanan dan database lain di project tidak disentuh. Skrip mencetak alamat server dan kode keluarga; isi keduanya di aplikasi.

Model: `gemini-3.8-flash` (utama) dan `gemini-3.5-flash-lite` (cadangan otomatis bila utama gagal atau keluarannya tidak lolos validasi), lewat endpoint `global` Vertex AI. Ganti dengan variabel `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL`. Batas default 20 panggilan AI per keluarga per hari (`DAILY_CALL_LIMIT`). Server publik tetapi setiap permintaan butuh kode keluarga.

### Membangun APK sendiri

Butuh JDK 21 dan Android SDK (atau Android Studio):

```bash
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
# hasil: android/app/build/outputs/apk/debug/app-debug.apk
```

APK di Releases ditandatangani dengan kunci debug. Untuk tanda tangan rilis yang tetap (agar pembaruan bisa dipasang di atas versi lama tanpa uninstall), tambahkan secrets repo: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Privasi

- Data disimpan di HP (localStorage). Server hanya menerima log harian ringkas, foto yang dipilih untuk dibaca, dan ringkasan status.
- Lio bisa melihat semua yang dicatat (layar "Yang dicatat") dan bisa **menjeda pencatatan**. Saat dijeda, hanya obat yang tetap dicatat demi keamanan.
- Data lama dihapus berkala: di HP setelah 60 hari (foto 14 hari), di server setelah 30 hari.
- Kunci API hanya ada di server, tidak pernah di HP.

## Keterbatasan yang diketahui

- Perilaku tiap merek HP (Xiaomi, Oppo, Vivo, Samsung) terhadap alarm latar belakang belum diverifikasi. Tes di HP Lio sebelum dipakai.
- Peringatan ke HP keluarga memakai polling (WorkManager, minimal 15 menit), bukan push. Bila aplikasi keluarga terbuka, dicek tiap menit.
- Versi web hanya bisa mengingatkan saat halaman terbuka; untuk alarm di atas kunci layar gunakan APK.
- Suara bahasa Indonesia bergantung pada mesin TTS di HP (Google TTS menyediakan "Bahasa Indonesia").
- Fase 2 belum dibuat: kalender, galeri, aktivitas/langkah, pemakaian aplikasi, latihan khusus kiri-kanan.

## Lisensi

MIT
