package id.strokuni.app

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(StrokuniPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
