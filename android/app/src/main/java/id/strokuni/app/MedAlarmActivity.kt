package id.strokuni.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.ContextCompat
import java.util.Locale

/**
 * Full-screen medication screen shown above the lock screen.
 * One large button. Always closable. Never suggests doubling a dose.
 */
class MedAlarmActivity : Activity() {
    private var tts: TextToSpeech? = null
    private lateinit var key: String
    private lateinit var date: String
    private var test = false

    private val bg = Color.parseColor("#FFDF9E")
    private val fg = Color.parseColor("#261A00")
    private val btnBg = Color.parseColor("#785900")
    private val okBg = Color.parseColor("#ABF5A3")
    private val okFg = Color.parseColor("#002204")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.statusBarColor = bg
        render(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        render(intent)
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun text(s: String, sp: Float, bold: Boolean = false, color: Int = fg) = TextView(this).apply {
        text = s
        setTextColor(color)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setPadding(0, dp(6), 0, dp(6))
    }

    private fun bigButton(label: String, fill: Int, textColor: Int, heightDp: Int, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setTextColor(textColor)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, if (heightDp >= 80) 26f else 20f)
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        background = GradientDrawable().apply { setColor(fill); cornerRadius = dp(28).toFloat() }
        stateListAnimator = null
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(heightDp)).apply { topMargin = dp(12) }
        setOnClickListener { onClick() }
    }

    private fun render(i: Intent) {
        key = i.getStringExtra(AlarmScheduler.EXTRA_KEY) ?: run { finish(); return }
        date = i.getStringExtra(AlarmScheduler.EXTRA_DATE) ?: Prefs.dateKey()
        test = i.getBooleanExtra(AlarmScheduler.EXTRA_TEST, false)
        val time = i.getStringExtra(AlarmScheduler.EXTRA_TIME) ?: ""
        val name = i.getStringExtra("name") ?: "Obat"
        val dose = i.getStringExtra("dose") ?: ""
        val note = i.getStringExtra("note") ?: ""
        val late = i.getIntExtra("late", 0)
        val cfg = Prefs.config(this)
        val patient = cfg.optString("patientName", "Lio").ifBlank { "Lio" }
        val familyName = cfg.optString("familyName").ifBlank { "Keluarga" }
        val phone = cfg.optString("familyPhone")
        val (_, _, callMin) = Prefs.escalation(this)

        if (Prefs.isTaken(this, date, key)) { showDone(Prefs.hm()); return }

        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
            setPadding(dp(28), dp(48), dp(28), dp(32))
            gravity = Gravity.CENTER_VERTICAL
        }
        col.addView(text(if (late > 0) "Obat jam $time" else "Waktunya minum obat", 22f, true))
        col.addView(text("💊", 72f))
        col.addView(text(name, 42f, true))
        if (dose.isNotBlank()) col.addView(text(dose, 28f))
        if (note.isNotBlank()) col.addView(text(note, 22f))
        if (late >= callMin) {
            col.addView(text("Sudah lewat $late menit. Jangan minum dua kali. Kalau ragu, telepon keluarga atau dokter.", 20f, true).apply {
                background = GradientDrawable().apply { setColor(Color.parseColor("#33785900")); cornerRadius = dp(20).toFloat() }
                setPadding(dp(16), dp(16), dp(16), dp(16))
            })
        }
        col.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(16)) })
        col.addView(bigButton("✓  Sudah diminum", btnBg, Color.WHITE, 96) { onTaken() })
        if ((late >= callMin || late >= 30) && phone.isNotBlank()) {
            col.addView(bigButton("📞  Telepon $familyName", Color.parseColor("#CCE8E7"), Color.parseColor("#051F1F"), 72) { callFamily(phone) })
        }
        col.addView(bigButton("Tutup", Color.TRANSPARENT, fg, 64) { stopTts(); finish() })
        setContentView(ScrollView(this).apply { setBackgroundColor(bg); isFillViewport = true; addView(col) })

        val speech = buildString {
            append("$patient, ")
            append(if (late > 0) "ingat minum obat " else "waktunya minum obat ")
            append(name)
            if (dose.isNotBlank()) append(", $dose")
            append(". Setelah diminum, tekan tombol Sudah diminum.")
        }
        speak(speech)
    }

    private fun onTaken() {
        val at = AlarmReceiver.confirm(this, key, date)
        val hm = Prefs.hm()
        speak(if (at != null) "Terima kasih. Obat sudah diminum jam $hm." else "Obat ini sudah dikonfirmasi.")
        showDone(hm)
        Handler(Looper.getMainLooper()).postDelayed({ if (!isFinishing) finish() }, 4000)
    }

    private fun showDone(hm: String) {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(okBg)
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(48), dp(28), dp(32))
        }
        col.addView(text("🔒", 56f, color = okFg).apply { gravity = Gravity.CENTER })
        col.addView(text("Sudah diminum jam $hm", 34f, true, okFg).apply { gravity = Gravity.CENTER })
        col.addView(text("Tombol terkunci sampai jadwal berikutnya.", 20f, color = okFg).apply { gravity = Gravity.CENTER })
        col.addView(bigButton("Tutup", Color.parseColor("#286C2A"), Color.WHITE, 72) { finish() })
        window.statusBarColor = okBg
        setContentView(col)
    }

    private fun callFamily(phone: String) {
        val uri = Uri.parse("tel:" + phone.filter { it.isDigit() || it == '+' })
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED
        runCatching { startActivity(Intent(if (granted) Intent.ACTION_CALL else Intent.ACTION_DIAL, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    private fun speak(s: String) {
        val t = tts
        if (t != null) { t.speak(s, TextToSpeech.QUEUE_FLUSH, null, "med"); return }
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale("id", "ID")
                tts?.setSpeechRate(0.9f)
                tts?.speak(s, TextToSpeech.QUEUE_FLUSH, null, "med")
            }
        }
    }

    private fun stopTts() { tts?.stop() }

    override fun onDestroy() {
        tts?.shutdown(); tts = null
        super.onDestroy()
    }
}
