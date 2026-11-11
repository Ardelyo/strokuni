package id.strokuni.app

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Native-side storage: schedule mirror (for boot), config, confirmations made on the alarm screen. */
object Prefs {
    private const val NAME = "strokuni"
    private fun sp(ctx: Context): SharedPreferences = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun saveSchedule(ctx: Context, json: String) = sp(ctx).edit().putString("schedule", json).apply()
    fun schedule(ctx: Context): JSONObject? = sp(ctx).getString("schedule", null)?.let { runCatching { JSONObject(it) }.getOrNull() }

    fun saveConfig(ctx: Context, json: JSONObject) = sp(ctx).edit().putString("config", json.toString()).apply()
    fun config(ctx: Context): JSONObject = sp(ctx).getString("config", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()

    fun escalation(ctx: Context): Triple<Int, Int, Int> {
        val e = schedule(ctx)?.optJSONObject("escalation")
        return Triple(e?.optInt("repeatMin", 10) ?: 10, e?.optInt("alertMin", 30) ?: 30, e?.optInt("callMin", 60) ?: 60)
    }

    fun findDose(ctx: Context, key: String): JSONObject? {
        val arr = schedule(ctx)?.optJSONArray("doses") ?: return null
        for (i in 0 until arr.length()) {
            val d = arr.optJSONObject(i) ?: continue
            if (d.optString("key") == key) return d
        }
        return null
    }

    fun scheduledKeys(ctx: Context): Set<String> = sp(ctx).getStringSet("keys", emptySet()) ?: emptySet()
    fun setScheduledKeys(ctx: Context, keys: Set<String>) = sp(ctx).edit().putStringSet("keys", keys).apply()

    private fun taken(ctx: Context): JSONObject = sp(ctx).getString("taken", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()

    @Synchronized
    fun markTaken(ctx: Context, date: String, key: String, at: String): Boolean {
        val t = taken(ctx)
        val id = "$date|$key"
        if (t.has(id)) return false
        t.put(id, at)
        // keep the last 7 days only
        val cutoff = dateKey(Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -7) })
        val names = t.keys().asSequence().toList()
        for (n in names) if (n.substringBefore('|') < cutoff) t.remove(n)
        sp(ctx).edit().putString("taken", t.toString()).apply()
        return true
    }

    fun isTaken(ctx: Context, date: String, key: String) = taken(ctx).has("$date|$key")

    fun takenList(ctx: Context): JSONArray {
        val t = taken(ctx)
        val out = JSONArray()
        for (n in t.keys()) out.put(JSONObject().put("date", n.substringBefore('|')).put("key", n.substringAfter('|')).put("at", t.optString(n)))
        return out
    }

    fun alerted(ctx: Context, id: String) = sp(ctx).getBoolean("alerted:$id", false)
    fun setAlerted(ctx: Context, id: String) = sp(ctx).edit().putBoolean("alerted:$id", true).apply()

    fun lastAlertSeen(ctx: Context) = sp(ctx).getLong("lastAlertSeen", System.currentTimeMillis())
    fun setLastAlertSeen(ctx: Context, v: Long) = sp(ctx).edit().putLong("lastAlertSeen", v).apply()

    fun dateKey(cal: Calendar = Calendar.getInstance()): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.time)

    fun hm(date: Date = Date()): String = SimpleDateFormat("HH:mm", Locale.US).format(date)

    fun isoNow(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())

    fun parseIso(s: String): Long = runCatching {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(s)!!.time
    }.getOrDefault(0L)
}
