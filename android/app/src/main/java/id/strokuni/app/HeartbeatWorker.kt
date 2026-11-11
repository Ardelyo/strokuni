package id.strokuni.app

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Layer 2 of 3 for reliability: a periodic "masih hidup" signal from Lio's phone.
 * If it stops, the server raises a "stale" alert to family phones.
 * On a family phone the same worker polls for alerts and shows a high-priority notification.
 */
class HeartbeatWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        if (!Net.configured(ctx)) return Result.success()
        val role = Prefs.config(ctx).optString("role", "lio")
        if (role == "family") {
            val since = Prefs.lastAlertSeen(ctx)
            val r = Net.get(ctx, "/api/alerts?since=$since") ?: return Result.retry()
            val arr = r.optJSONArray("alerts")
            var newest = since
            if (arr != null) for (i in 0 until arr.length()) {
                val a = arr.optJSONObject(i) ?: continue
                val at = Prefs.parseIso(a.optString("at"))
                if (a.optString("type") == "stale" || at > since) {
                    Notifications.familyAlert(ctx, a.optString("id").hashCode() and 0xFFF, a.optString("message"))
                    if (at > newest) newest = at
                }
            }
            Prefs.setLastAlertSeen(ctx, newest)
        } else {
            Net.post(ctx, "/api/heartbeat", JSONObject().put("role", "lio").put("at", Prefs.isoNow()).put("taken", Prefs.takenList(ctx)).put("source", "native"))
                ?: return Result.retry()
        }
        return Result.success()
    }

    companion object {
        private const val NAME = "strokuni-heartbeat"
        fun ensure(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<HeartbeatWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, req)
        }
    }
}
