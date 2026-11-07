package com.acocalypso.magictester
import android.app.Application
class MagicTesterApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Recovery belongs to a new coordinator process, not each reopened window.
        val process = if(android.os.Build.VERSION.SDK_INT >= 28) getProcessName() else java.io.File("/proc/self/cmdline").readText().trimEnd('\u0000')
        if(!process.endsWith(":forge")) RunStore(this).use { it.recover() }
    }
}
