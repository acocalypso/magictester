package com.acocalypso.magictester
import android.app.Application
class MagicTesterApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Diagnostics.install(this)
        // Recovery belongs to a new coordinator process, not each reopened window.
        val process = if(android.os.Build.VERSION.SDK_INT >= 28) getProcessName() else java.io.File("/proc/self/cmdline").readText().trimEnd('\u0000')
        if(!process.endsWith(":forge")) {
            val store=RunStore(this)
            try { store.recover();Diagnostics.event("database.ready","Local history opened and interrupted runs recovered") }
            catch(error:Exception) { Diagnostics.event("database.error","Local history could not be opened",level="ERROR",error=error) }
            finally { store.close() }
        }
        Diagnostics.event("app.ready","Application initialization finished")
    }
}
