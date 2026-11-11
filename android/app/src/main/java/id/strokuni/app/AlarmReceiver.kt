package id.strokuni.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import kotlin.concurrent.thread

/** Fires at dose time and on every follow-up stage. Escalation: repeat -> family alert -> call button. */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            AlarmScheduler.ACTION_EVENING -> {
                val sched = Prefs.schedule(ctx)
                Notifications.evening(ctx, sched?.optString("patientName", "Lio") ?: "Lio")
                AlarmScheduler.scheduleEvening(ctx, sched?.optString("summaryTime", "21:00") ?: "21:00")
            }
            AlarmScheduler.ACTION_TAKEN -> {
                val key = intent.getStringExtra(AlarmScheduler.EXTRA_KEY) ?: return
                val date = intent.getStringExtra(AlarmScheduler.EXTRA_DATE) ?: return
                confirm(ctx, key, date)
            }
            AlarmScheduler.ACTION_DOSE -> handleDose(ctx, intent)
        }
    }

    private fun handleDose(ctx: Context, intent: Intent) {
        val key = intent.getStringExtra(AlarmScheduler.EXTRA_KEY) ?: return
        val date = intent.getStringExtra(AlarmScheduler.EXTRA_DATE) ?: Prefs.dateKey()
        val time = intent.getStringExtra(AlarmScheduler.EXTRA_TIME) ?: ""
        val stage = intent.getIntExtra(AlarmScheduler.EXTRA_STAGE, 0)
        val test = intent.getBooleanExtra(AlarmScheduler.EXTRA_TEST, false)
        val dose = if (test) JSONObject().put("name", "Tes alarm").put("dose", "Ini hanya tes").put("note", "Tekan Sudah diminum untuk menutup.") else Prefs.findDose(ctx, key)

        // Stage 0: always plan tomorrow's alarm first, even if today's is already taken.
        if (!test && stage == 0 && dose != null) AlarmScheduler.scheduleNext(ctx, dose)
        if (dose == null) return // removed from schedule
        if (Prefs.isTaken(ctx, date, key)) return // double-dose lock: already confirmed

        val (repeatMin, alertMin, _) = Prefs.escalation(ctx)
        val late = stage * repeatMin
        Notifications.showDose(ctx, key, date, time, dose.optString("name"), dose.optString("dose"), dose.optString("note"), late, test)

        if (test) return
        if (stage < AlarmScheduler.MAX_STAGE) AlarmScheduler.scheduleFollowUp(ctx, key, time, date, stage + 1, repeatMin)

        val alertId = "$date|$key"
        if (late >= alertMin && !Prefs.alerted(ctx, alertId)) {
            Prefs.setAlerted(ctx, alertId)
            val patient = Prefs.schedule(ctx)?.optString("patientName", "Lio") ?: "Lio"
            val msg = "$patient belum mengonfirmasi ${dose.optString("name")} jam $time ($late menit)."
            val pending = goAsync()
            thread {
                try { Net.post(ctx, "/api/alerts", JSONObject().put("type", "missed_dose").put("message", msg).put("dedupe", alertId)) }
                finally { pending.finish() }
            }
        }
        // The big "Telepon" button after callMin is shown by MedAlarmActivity based on lateness.
    }

    companion object {
        /** Confirm a dose from the alarm screen or the notification action. */
        fun confirm(ctx: Context, key: String, date: String): String? {
            val at = Prefs.isoNow()
            val fresh = Prefs.markTaken(ctx, date, key, at)
            AlarmScheduler.cancelFollowUps(ctx, key)
            Notifications.cancelDose(ctx, key)
            if (fresh) StrokuniPlugin.instance?.emitTaken(key, date, at)
            return if (fresh) at else null
        }
    }
}
