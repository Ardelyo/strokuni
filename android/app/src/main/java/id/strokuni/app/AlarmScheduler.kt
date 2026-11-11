package id.strokuni.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject
import java.util.Calendar

/**
 * Layer 1 of 3 for reliability: AlarmManager.setAlarmClock (most reliable under Doze / battery saver).
 * Follow-up reminders (escalation) use setExactAndAllowWhileIdle.
 */
object AlarmScheduler {
    const val ACTION_DOSE = "id.strokuni.app.DOSE"
    const val ACTION_EVENING = "id.strokuni.app.EVENING"
    const val ACTION_TAKEN = "id.strokuni.app.TAKEN"
    const val EXTRA_KEY = "key"
    const val EXTRA_DATE = "date"
    const val EXTRA_TIME = "time"
    const val EXTRA_STAGE = "stage"
    const val EXTRA_TEST = "test"
    const val MAX_STAGE = 18
    private const val EVENING_CODE = 777_001

    private fun am(ctx: Context) = ctx.getSystemService(AlarmManager::class.java)

    fun canExact(ctx: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am(ctx).canScheduleExactAlarms() else true

    fun reqCode(key: String, stage: Int) = key.hashCode() * 31 + stage

    private fun doseIntent(ctx: Context) = Intent(ctx, AlarmReceiver::class.java).setAction(ACTION_DOSE)

    private fun showIntent(ctx: Context): PendingIntent =
        PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** Next occurrence of HH:MM strictly after now. */
    fun nextTrigger(time: String, now: Calendar = Calendar.getInstance()): Calendar {
        val (h, m) = time.split(":").map { it.toInt() }
        val c = (now.clone() as Calendar).apply {
            set(Calendar.HOUR_OF_DAY, h); set(Calendar.MINUTE, m); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }
        if (c.timeInMillis <= now.timeInMillis + 1000) c.add(Calendar.DAY_OF_YEAR, 1)
        return c
    }

    fun rescheduleAll(ctx: Context): Int {
        val sched = Prefs.schedule(ctx) ?: return 0
        val doses = sched.optJSONArray("doses")
        val keys = mutableSetOf<String>()
        if (doses != null) for (i in 0 until doses.length()) {
            val d = doses.optJSONObject(i) ?: continue
            scheduleNext(ctx, d) // replaces the existing main alarm; running follow-ups are kept
            keys.add(d.optString("key"))
        }
        // doses removed by the family: cancel main alarm and follow-ups
        for (k in Prefs.scheduledKeys(ctx) - keys) cancelAll(ctx, k)
        Prefs.setScheduledKeys(ctx, keys)
        scheduleEvening(ctx, sched.optString("summaryTime", "21:00"))
        return keys.size
    }

    fun scheduleNext(ctx: Context, dose: JSONObject) {
        val key = dose.optString("key")
        val time = dose.optString("time")
        if (key.isEmpty() || !Regex("^\\d{2}:\\d{2}$").matches(time)) return
        val cal = nextTrigger(time)
        val intent = doseIntent(ctx)
            .putExtra(EXTRA_KEY, key).putExtra(EXTRA_TIME, time)
            .putExtra(EXTRA_DATE, Prefs.dateKey(cal)).putExtra(EXTRA_STAGE, 0)
        val pi = PendingIntent.getBroadcast(ctx, reqCode(key, 0), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        setReliable(ctx, cal.timeInMillis, pi, clock = true)
    }

    fun scheduleFollowUp(ctx: Context, key: String, time: String, date: String, stage: Int, delayMin: Int, test: Boolean = false) {
        val intent = doseIntent(ctx)
            .putExtra(EXTRA_KEY, key).putExtra(EXTRA_TIME, time)
            .putExtra(EXTRA_DATE, date).putExtra(EXTRA_STAGE, stage).putExtra(EXTRA_TEST, test)
        val pi = PendingIntent.getBroadcast(ctx, reqCode(key, stage), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        setReliable(ctx, System.currentTimeMillis() + delayMin * 60_000L, pi, clock = false)
    }

    /** Test alarm in N seconds (no follow-ups, no reschedule). */
    fun scheduleTest(ctx: Context, seconds: Int) {
        val intent = doseIntent(ctx)
            .putExtra(EXTRA_KEY, "test@alarm").putExtra(EXTRA_TIME, Prefs.hm())
            .putExtra(EXTRA_DATE, Prefs.dateKey()).putExtra(EXTRA_STAGE, 0).putExtra(EXTRA_TEST, true)
        val pi = PendingIntent.getBroadcast(ctx, reqCode("test@alarm", 0), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        setReliable(ctx, System.currentTimeMillis() + seconds * 1000L, pi, clock = true)
    }

    private fun setReliable(ctx: Context, at: Long, pi: PendingIntent, clock: Boolean) {
        val am = am(ctx)
        try {
            if (canExact(ctx)) {
                if (clock) am.setAlarmClock(AlarmManager.AlarmClockInfo(at, showIntent(ctx)), pi)
                else am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            }
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
    }

    fun cancelFollowUps(ctx: Context, key: String) {
        for (s in 1..MAX_STAGE) cancelCode(ctx, reqCode(key, s))
    }

    fun cancelAll(ctx: Context, key: String) {
        for (s in 0..MAX_STAGE) cancelCode(ctx, reqCode(key, s))
    }

    private fun cancelCode(ctx: Context, code: Int) {
        val pi = PendingIntent.getBroadcast(ctx, code, doseIntent(ctx), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
        if (pi != null) { am(ctx).cancel(pi); pi.cancel() }
    }

    fun scheduleEvening(ctx: Context, time: String) {
        if (!Regex("^\\d{2}:\\d{2}$").matches(time)) return
        val cal = nextTrigger(time)
        val intent = Intent(ctx, AlarmReceiver::class.java).setAction(ACTION_EVENING)
        val pi = PendingIntent.getBroadcast(ctx, EVENING_CODE, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val am = am(ctx)
        try {
            if (canExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)
        }
    }
}
