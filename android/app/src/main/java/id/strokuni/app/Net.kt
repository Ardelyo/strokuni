package id.strokuni.app

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Minimal blocking HTTP client for background work. Call from a worker thread only. */
object Net {
    private fun base(ctx: Context): Pair<String, String>? {
        val c = Prefs.config(ctx)
        val url = c.optString("serverUrl").trimEnd('/')
        val code = c.optString("familyCode")
        return if (url.startsWith("http") && code.isNotEmpty()) url to code else null
    }

    fun configured(ctx: Context) = base(ctx) != null

    private fun request(ctx: Context, method: String, path: String, body: JSONObject?): JSONObject? {
        val (url, code) = base(ctx) ?: return null
        val conn = (URL(url + path).openConnection() as HttpURLConnection)
        return try {
            conn.requestMethod = method
            conn.connectTimeout = 10_000
            conn.readTimeout = 15_000
            conn.setRequestProperty("content-type", "application/json")
            conn.setRequestProperty("x-family-code", code)
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val ok = conn.responseCode in 200..299
            val text = (if (ok) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
            if (ok) JSONObject(text) else null
        } catch (e: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }

    fun post(ctx: Context, path: String, body: JSONObject) = request(ctx, "POST", path, body)
    fun get(ctx: Context, path: String) = request(ctx, "GET", path, null)
}
