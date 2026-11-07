package com.acocalypso.magictester

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

class QueueService: Service() {
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private lateinit var store: RunStore
    private var runner: Job?=null
    @Volatile private var currentId=""
    override fun onCreate() {
        super.onCreate();store=RunStore(this)
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
        return START_NOT_STICKY
    }
    private suspend fun queue() {
        try {
            while(true) {
                val run=store.next() ?: break
                if(!store.claim(run.id)) continue
                currentId=run.id
                try {
                    require(run.payload.getString("engineVersion")==BuildConfig.FORGE_VERSION) {"This run uses a different Forge version. Create a new analysis."}
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
            withContext(NonCancellable+Dispatchers.Main) {runner=null;if(store.next()!=null) runner=scope.launch {queue()} else {stopForeground(STOP_FOREGROUND_REMOVE);stopSelf()}}
        }
    }
    private suspend fun analysis(run: Run) {
        val payload=run.payload;val total=payload.getInt("games")
        val done=store.successfulIndices(run.id).toMutableSet()
        val count=AtomicInteger(done.size)
        val pending=(0 until total).filter {it !in done}.toMutableList()
        val profile=PerformanceSettings.profile(payload.getString("format"),payload.optInt("players",4))
        while(pending.isNotEmpty() && store.get(run.id)?.state=="running") {
            val limit=minOf(PerformanceSettings.limit(this,profile),PerformanceSettings.candidates(this,profile).coerceAtLeast(1))
            val wave=pending.take(limit);repeat(wave.size) {pending.removeAt(0)}
            Diagnostics.event("parallel.wave","Scheduling ${wave.size} isolated games",run.id,details=JSONObject().put("configured",PerformanceSettings.selected(this)).put("effectiveLimit",limit))
            val outcomes=supervisorScope {wave.map {unit->async {runCatching {runUnit(run,unit,count,total)}}}.awaitAll()}
            outcomes.firstOrNull {it.isFailure}?.exceptionOrNull()?.let {throw it}
        }
        store.update(run.id,"complete","All requested matches have recorded outcomes",count.get(),onlyIfRunning=true)
    }
    private suspend fun runUnit(run: Run,unit: Int,count: AtomicInteger,total: Int) {
        if(store.get(run.id)?.state!="running") return
        val request=SimulationRequest.unit(run.payload,unit)
        val wake=getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"MagicTester:match")
        try {
            wake.acquire((request.getInt("clockSeconds")*(if(request.optInt("bestOf")==3) 5 else 1)+480)*CapacityMath.MAX_ENGINES*1000L)
            Diagnostics.event("attempt.started","Starting match ${unit+1}/$total",run.id,details=PerformanceSettings.resources(this).put("unit",unit))
            val result=ForgeClient.execute(this,request,run.id,onGame={store.gameEvent(run.id,it)},allowed={store.get(run.id)?.state=="running"}) {label,_->
                store.update(run.id,"running","Match ${unit+1}/$total · $label",count.get(),onlyIfRunning=true);progress("${count.get()}/$total matches saved · $label")
            }
            val destination=try {store.saveAttempt(run.id,result,unit)} finally {result.delete()}
            if(destination==null) return
            val events=destination.readLines().filter {it.isNotBlank()}.map {JSONObject(it)}
            events.firstOrNull {it.optString("type")=="error"}?.let {error(it.optString("message"))}
            val outcome=events.firstOrNull {it.optString("type")=="result"}?.getJSONObject("result") ?: error("Forge returned no game evidence")
            require(outcome.optString("termination") in listOf("normal","rule_draw")) {"Match ${unit+1}: ${outcome.optString("termination").replace('_',' ')}. Review evidence or resume with a longer timeout."}
            store.update(run.id,"running","Saved ${count.incrementAndGet()}/$total matches",count.get(),onlyIfRunning=true)
        } finally {if(wake.isHeld) wake.release()}
    }
    override fun onBind(intent: Intent?)=null
    override fun onDestroy() {if(currentId.isNotEmpty()) {ForgeClient.cancel(currentId);store.update(currentId,"interrupted","Android stopped the analysis. Resume to continue.",onlyIfRunning=true)};scope.cancel();store.close();super.onDestroy()}
    override fun onTimeout(startId: Int,fgsType: Int) {if(currentId.isNotEmpty()) ForgeClient.cancel(currentId);stopSelf()}
}
