package id.strokuni.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object Notifications {
    const val CH_DOSE = "dose"
    const val CH_FAMILY = "family"
    const val CH_GENERAL = "general"
    private const val EVENING_ID = 21_000
    private const val PRIMARY = 0xFF006A6A.toInt()
    private const val MED = 0xFF785900.toInt()

    fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        nm.createNotificationChannel(NotificationChannel(CH_DOSE, "Pengingat obat", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Layar penuh saat waktunya minum obat"
            setSound(alarmSound, attrs)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 400, 300, 400)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            setBypassDnd(true)
        })
        nm.createNotificationChannel(NotificationChannel(CH_FAMILY, "Peringatan untuk keluarga", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Obat belum dikonfirmasi atau HP Lio tidak aktif"
            enableVibration(true)
        })
        nm.createNotificationChannel(NotificationChannel(CH_GENERAL, "Catatan malam", NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun canPost(ctx: Context) =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun doseId(key: String) = 10_000 + (key.hashCode() and 0xFFFF)

    /** Full-screen intent notification: turns the screen on above the lock screen. */
    fun showDose(ctx: Context, key: String, date: String, time: String, name: String, dose: String, note: String, lateMin: Int, test: Boolean) {
        ensureChannels(ctx)
        val alarm = Intent(ctx, MedAlarmActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(AlarmScheduler.EXTRA_KEY, key); putExtra(AlarmScheduler.EXTRA_DATE, date); putExtra(AlarmScheduler.EXTRA_TIME, time)
            putExtra("name", name); putExtra("dose", dose); putExtra("note", note); putExtra("late", lateMin); putExtra(AlarmScheduler.EXTRA_TEST, test)
        }
        val full = PendingIntent.getActivity(ctx, doseId(key), alarm, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val takenIntent = Intent(ctx, AlarmReceiver::class.java).setAction(AlarmScheduler.ACTION_TAKEN)
            .putExtra(AlarmScheduler.EXTRA_KEY, key).putExtra(AlarmScheduler.EXTRA_DATE, date)
        val taken = PendingIntent.getBroadcast(ctx, doseId(key) + 1, takenIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val text = listOf(name, dose).filter { it.isNotBlank() }.joinToString(" · ")
        val n = NotificationCompat.Builder(ctx, CH_DOSE)
            .setSmallIcon(R.drawable.ic_stat_pill)
            .setColor(MED)
            .setContentTitle(if (lateMin > 0) "Ingat minum obat ($time)" else "Waktunya minum obat")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(listOf(text, note).filter { it.isNotBlank() }.joinToString("\n")))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(full, true)
            .setContentIntent(full)
            .setOngoing(!test)
            .setAutoCancel(test)
            .addAction(0, "Sudah diminum", taken)
            .build()
        if (canPost(ctx)) NotificationManagerCompat.from(ctx).notify(doseId(key), n)
        else runCatching { ctx.startActivity(alarm) } // fallback (may be blocked on Android 10+ without overlay permission)
    }

    fun cancelDose(ctx: Context, key: String) = NotificationManagerCompat.from(ctx).cancel(doseId(key))

    fun evening(ctx: Context, patient: String) {
        ensureChannels(ctx)
        val open = PendingIntent.getActivity(ctx, EVENING_ID, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, CH_GENERAL)
            .setSmallIcon(R.drawable.ic_stat_pill).setColor(PRIMARY)
            .setContentTitle("Catatan malam")
            .setContentText("$patient, ceritakan hari ini. Buka Strokuni.")
            .setContentIntent(open).setAutoCancel(true).build()
        if (canPost(ctx)) NotificationManagerCompat.from(ctx).notify(EVENING_ID, n)
    }

    fun familyAlert(ctx: Context, id: Int, message: String) {
        ensureChannels(ctx)
        val open = PendingIntent.getActivity(ctx, 30_000 + id, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, CH_FAMILY)
            .setSmallIcon(R.drawable.ic_stat_pill).setColor(0xFFBA1A1A.toInt())
            .setContentTitle("Peringatan Strokuni")
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(open).setAutoCancel(true).build()
        if (canPost(ctx)) NotificationManagerCompat.from(ctx).notify(30_000 + id, n)
    }
}
