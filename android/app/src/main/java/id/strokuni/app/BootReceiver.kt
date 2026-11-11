package id.strokuni.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restores alarms after reboot, app update, or time/timezone change. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" -> {
                Notifications.ensureChannels(ctx)
                AlarmScheduler.rescheduleAll(ctx)
                HeartbeatWorker.ensure(ctx)
            }
        }
    }
}
