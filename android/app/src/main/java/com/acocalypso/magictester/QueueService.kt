package com.acocalypso.magictester

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.*
import org.json.JSONObject

class QueueService: Service() {
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private lateinit var store: RunStore
    private var runner: Job?=null
    private var destroying=false
    @Volatile private var currentId=""
    override fun onCreate() {
        super.onCreate();store=RunStore(this)
        scope.coroutineContext[Job]!!.invokeOnCompletion {store.close()}
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("runs","Deck analyses",NotificationManager.IMPORTANCE_LOW))
        scope.launch {while(isActive) {delay(5000);val id=currentId;if(id.isNotEmpty()) runCatching {store.checkpointGame(id)}}}
    }
    private fun progress(text: String) {
        val notification=NotificationCompat.Builder(this,"runs").setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("MagicTester · local analysis").setContentText(text).setOngoing(true)
            .setContentIntent(PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE)).build()
        ServiceCompat.startForeground(this,42,notification,if(Build.VERSION.SDK_INT>=34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
    }
    override fun onStartCommand(intent: Intent?,flags: Int,startId: Int): Int {
        progress("Preparing queued work")
        if(intent?.action=="cancel") {
            val id=intent.getStringExtra("id") ?: ""
            store.get(id)?.let {if(it.state in listOf("running","queued")) store.update(id,"cancelled","Cancelled. Completed evidence is saved.")}
            ForgeClient.cancel(id)
        }
        if(runner?.isActive!=true) runner=scope.launch {queue()}
        // Rebuild work from SQLite after a process restart; never redeliver a
        // cancellation intent as if it were a new user command.
        return START_STICKY
    }
    private suspend fun queue() {
        try {
            while(true) {
                val run=store.next() ?: break
                if(!store.claim(run.id)) continue
                currentId=run.id
                try {
                    require(run.payload.getString("engineVersion")==BuildConfig.FORGE_VERSION) {"This run uses a different Forge version. Create a new analysis."}
                    EngineBuild.requireExpected(run.payload.optString("engineBuildSha256"),EngineBuild.fingerprint(this))
                    require(getSystemService(ActivityManager::class.java).largeMemoryClass>=384) {"This device must allow a large heap of at least 384 MiB for Forge."}
                    ForgeRelease.requireCurrent(this)
                    Diagnostics.event("run.started","Starting local work",run.id,details=DiagnosticExporter.device(this))
                    if(run.payload.optString("kind")=="benchmark") {
                        val wake=getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"MagicTester:benchmark")
                        try {wake.acquire(90*60000L);BenchmarkRunner.run(this,store,run) {label->progress(label);store.update(run.id,"running",label,onlyIfRunning=true)}} finally {if(wake.isHeld) wake.release()}
                    } else analysis(run)
                } catch(error:Throwable) {
                    Diagnostics.event("run.exception",error.message ?: "Local work failed",run.id,level=if(store.get(run.id)?.state=="cancelled") "INFO" else "ERROR",error=error)
                    store.update(run.id,"failed",error.message ?: "Local engine stopped",onlyIfRunning=true)
                } finally {ForgeClient.cancel(run.id)}
            }
        } finally {
            currentId=""
            withContext(NonCancellable+Dispatchers.Main) {runner=null;if(!destroying) {if(store.next()!=null) runner=scope.launch {queue()} else {stopForeground(STOP_FOREGROUND_REMOVE);stopSelf()}}}
        }
    }
    private suspend fun analysis(run: Run) {
        val payload=run.payload;val total=payload.getInt("games")
        val profile=PerformanceSettings.profile(payload.getString("format"),payload.optInt("players",4))
        AnalysisRunner.run(store,run,
            parallelism={minOf(PerformanceSettings.limit(this,profile),PerformanceSettings.candidates(this,profile).coerceAtLeast(1))},
            execute={unit->runUnit(run,unit,total)},progress={progress(it)})
    }
    private suspend fun runUnit(run: Run,unit: Int,total: Int): java.io.File {
        val request=SimulationRequest.unit(run.payload,unit)
        val opponents=MatchOpponents.names(run.payload,unit)
        val matchup="Match ${unit+1}/$total"+if(opponents.isNotEmpty()) " · vs ${opponents.joinToString(", ")}" else ""
        val wake=getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"MagicTester:match")
        try {
            wake.acquire((request.getInt("clockSeconds")*(if(request.optInt("bestOf")==3) 5 else 1)+480)*CapacityMath.MAX_ENGINES*1000L)
            Diagnostics.event("attempt.started","Starting match ${unit+1}/$total",run.id,details=PerformanceSettings.resources(this).put("unit",unit))
            store.update(run.id,"running","$matchup · Preparing engine",onlyIfRunning=true)
            progress("$matchup · Preparing engine")
            return ForgeClient.execute(this,request,run.id,onGame={store.gameEvent(run.id,it)},allowed={store.get(run.id)?.state=="running"}) {label,_->
                store.update(run.id,"running","$matchup · $label",onlyIfRunning=true);progress("${store.get(run.id)?.completed ?: 0}/$total saved · $matchup · $label")
            }
        } finally {if(wake.isHeld) wake.release()}
    }
    override fun onBind(intent: Intent?)=null
    override fun onDestroy() {destroying=true;if(currentId.isNotEmpty()) {ForgeClient.cancel(currentId);store.update(currentId,"interrupted","Android stopped the analysis. Resume to continue.",onlyIfRunning=true)};scope.cancel();super.onDestroy()}
    override fun onTimeout(startId: Int,fgsType: Int) {if(currentId.isNotEmpty()) ForgeClient.cancel(currentId);stopSelf()}
}
