package id.strokuni.app

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import androidx.activity.result.ActivityResult
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import java.util.Locale

/** JS bridge: window.Capacitor.Plugins.Strokuni (see www/js/native.js). */
@CapacitorPlugin(
    name = "Strokuni",
    permissions = [
        Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS]),
        Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO]),
        Permission(alias = "camera", strings = [Manifest.permission.CAMERA]),
        Permission(alias = "phone", strings = [Manifest.permission.CALL_PHONE]),
    ],
)
class StrokuniPlugin : Plugin() {
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeech: Pair<String, Float>? = null

    override fun load() {
        instance = this
        Notifications.ensureChannels(context)
        tts = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale("id", "ID")
                ttsReady = true
                pendingSpeech?.let { (t, r) -> doSpeak(t, r) }
                pendingSpeech = null
            }
        }
    }

    override fun handleOnDestroy() {
        tts?.shutdown(); tts = null
        if (instance === this) instance = null
        super.handleOnDestroy()
    }

    fun emitTaken(key: String, date: String, at: String) {
        notifyListeners("doseTaken", JSObject().put("key", key).put("date", date).put("at", at))
    }

    @PluginMethod
    fun configure(call: PluginCall) {
        Prefs.saveConfig(context, call.data)
        HeartbeatWorker.ensure(context)
        call.resolve()
    }

    @PluginMethod
    fun scheduleMeds(call: PluginCall) {
        Prefs.saveSchedule(context, call.data.toString())
        val n = AlarmScheduler.rescheduleAll(context)
        call.resolve(JSObject().put("scheduled", n).put("exact", AlarmScheduler.canExact(context)))
    }

    @PluginMethod
    fun markTaken(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key required")
        val date = call.getString("date") ?: Prefs.dateKey()
        Prefs.markTaken(context, date, key, call.getString("at") ?: Prefs.isoNow())
        AlarmScheduler.cancelFollowUps(context, key)
        Notifications.cancelDose(context, key)
        call.resolve()
    }

    @PluginMethod
    fun getTaken(call: PluginCall) {
        val list = Prefs.takenList(context)
        val arr = JSArray()
        for (i in 0 until list.length()) arr.put(list.getJSONObject(i))
        call.resolve(JSObject().put("taken", arr))
    }

    @PluginMethod
    fun checkStatus(call: PluginCall) {
        val ctx = context
        val pm = ctx.getSystemService(PowerManager::class.java)
        val fullScreen = if (Build.VERSION.SDK_INT >= 34) ctx.getSystemService(NotificationManager::class.java).canUseFullScreenIntent() else true
        call.resolve(JSObject()
            .put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled())
            .put("exactAlarm", AlarmScheduler.canExact(ctx))
            .put("fullScreen", fullScreen)
            .put("batteryIgnored", pm.isIgnoringBatteryOptimizations(ctx.packageName))
            .put("overlay", Settings.canDrawOverlays(ctx))
            .put("sdk", Build.VERSION.SDK_INT)
            .put("manufacturer", Build.MANUFACTURER)
            .put("model", Build.MODEL))
    }

    @PluginMethod
    fun openSetting(call: PluginCall) {
        val pkg = Uri.parse("package:" + context.packageName)
        val intent = when (call.getString("which")) {
            "exactAlarm" -> if (Build.VERSION.SDK_INT >= 31) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg) else appDetails(pkg)
            "fullScreen" -> if (Build.VERSION.SDK_INT >= 34) Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg) else appNotifications()
            "battery" -> Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg)
            "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg)
            "notifications" -> appNotifications()
            else -> appDetails(pkg)
        }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { context.startActivity(intent) } catch (e: Exception) { context.startActivity(appDetails(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        call.resolve()
    }

    private fun appDetails(pkg: Uri) = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)
    private fun appNotifications() = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)

    @PluginMethod
    fun speak(call: PluginCall) {
        val text = call.getString("text") ?: return call.resolve()
        val rate = (call.getFloat("rate") ?: 0.9f)
        if (ttsReady) doSpeak(text, rate) else pendingSpeech = text to rate
        call.resolve()
    }

    private fun doSpeak(text: String, rate: Float) {
        tts?.setSpeechRate(rate)
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "strokuni")
    }

    @PluginMethod
    fun stopSpeaking(call: PluginCall) { tts?.stop(); call.resolve() }

    @PluginMethod
    fun listen(call: PluginCall) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermissionCallback")
            return
        }
        startListening(call)
    }

    @com.getcapacitor.annotation.PermissionCallback
    fun micPermissionCallback(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) startListening(call)
        else call.reject("Izin mikrofon ditolak")
    }

    private fun startListening(call: PluginCall) {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "id-ID")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, call.getString("prompt") ?: "Silakan bicara")
        try { startActivityForResult(call, intent, "listenResult") }
        catch (e: Exception) { call.reject("Pengenalan suara tidak tersedia di HP ini") }
    }

    @ActivityCallback
    fun listenResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: ""
        call.resolve(JSObject().put("text", text))
    }

    @PluginMethod
    fun testAlarm(call: PluginCall) {
        AlarmScheduler.scheduleTest(context, call.getInt("seconds") ?: 10)
        call.resolve()
    }

    @PluginMethod
    fun callPhone(call: PluginCall) {
        val number = (call.getString("number") ?: "").filter { it.isDigit() || it == '+' }
        if (number.isEmpty()) return call.reject("Nomor kosong")
        val action = if (getPermissionState("phone") == PermissionState.GRANTED) Intent.ACTION_CALL else Intent.ACTION_DIAL
        activity.startActivity(Intent(action, Uri.parse("tel:$number")))
        call.resolve()
    }

    companion object {
        @Volatile var instance: StrokuniPlugin? = null
    }
}
