package com.acocalypso.magictester
import android.app.job.*
import android.content.ComponentName
import kotlinx.coroutines.*
class MetaJobService : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var work: Job? = null
    override fun onStartJob(params: JobParameters): Boolean {
        work = scope.launch {
            val meta = Metagame(this@MetaJobService)
            for(format in DeckText.formats) {
                ensureActive()
                try { meta.refresh(format) } catch(error:Exception) { getSharedPreferences("meta-status",MODE_PRIVATE).edit().putString(format,error.message).apply() }
            }
            try { ForgeRelease.check(this@MetaJobService) } catch(_:Exception) { }
            jobFinished(params,false)
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean { work?.cancel(); return true }
    override fun onDestroy() { scope.cancel();super.onDestroy() }
    companion object {
        fun schedule(context: android.content.Context) {
            val job = JobInfo.Builder(71,ComponentName(context,MetaJobService::class.java)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(24*3600000L,6*3600000L).setPersisted(true).build()
            context.getSystemService(JobScheduler::class.java).schedule(job)
        }
    }
}
