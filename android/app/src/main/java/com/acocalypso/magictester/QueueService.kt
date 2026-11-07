package com.acocalypso.magictester

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class QueueService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var store: RunStore
    private var runner: Job? = null
    private var currentId = ""
    override fun onCreate() {
        super.onCreate(); store = RunStore(this)
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("runs", "Deck analyses", NotificationManager.IMPORTANCE_LOW))
    }
    private fun notifyProgress(text: String) {
        val notification = NotificationCompat.Builder(this,"runs").setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("MagicTester · local analysis").setContentText(text).setOngoing(true)
            .setContentIntent(PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE)).build()
        ServiceCompat.startForeground(this,42,notification,if(Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        notifyProgress("Preparing queued analyses")
        if (intent?.action == "cancel") {
            val id = intent.getStringExtra("id") ?: ""
            store.get(id)?.let { if (it.state in listOf("queued","running")) store.update(id,"cancelled","Cancelled. Completed game evidence is saved.") }
            ForgeClient.cancel(id)
        }
        if (runner?.isActive != true) runner = scope.launch { processQueue() }
        return START_NOT_STICKY
    }
    private suspend fun processQueue() {
        val wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"MagicTester:analysis")
        try {
            while (true) {
                val run = store.next() ?: break
                currentId = run.id
                store.update(run.id,"running","Checking available memory")
                try {
                    require(run.payload.getString("engineVersion") == BuildConfig.FORGE_VERSION) { "This run uses a different Forge version. Create a new analysis to keep its evidence consistent." }
                    val memory = ActivityManager.MemoryInfo().also { getSystemService(ActivityManager::class.java).getMemoryInfo(it) }
                    require(!memory.lowMemory && memory.availMem > 350L*1024*1024) { "Not enough free memory for Forge. Close other apps, then resume this run." }
                    val maxHeap = getSystemService(ActivityManager::class.java).largeMemoryClass
                    require(maxHeap >= 384) { "This device allows only $maxHeap MiB for Forge. At least 384 MiB is required." }
                    ForgeRelease.requireCurrent(this)
                    val payload = run.payload
                    val count = payload.getInt("games")
                    val completed = store.successfulIndices(run.id).toMutableSet()
                    val opponents = payload.getJSONArray("opponents")
                    require(opponents.length() > 0) { "Select an opponent deck." }
                    for (unit in 0 until count) {
                        if (unit in completed) continue
                        if (store.get(run.id)?.state != "running") break
                        val power = getSystemService(PowerManager::class.java)
                        if (Build.VERSION.SDK_INT >= 29 && power.currentThermalStatus >= PowerManager.THERMAL_STATUS_SEVERE) error("The phone is too hot. Let it cool, then resume this run.")
                        val timeout = payload.getInt("clockSeconds")
                        wake.acquire((timeout * (if(payload.optInt("bestOf") == 3) 5 else 1) + 300)*1000L)
                        val decks = JSONArray().put(payload.getString("deck"))
                        val seats = if (payload.getString("format") in listOf("commander","cedh")) payload.optInt("players",4) else 2
                        for (seat in 1 until seats) decks.put(opponents.getJSONObject((unit+seat-1)%opponents.length()).getString("text"))
                        val request = JSONObject().put("rawDecks",decks).put("format",payload.getString("format"))
                            .put("games",count).put("indices",JSONArray(listOf(unit))).put("seed",payload.getInt("seed"))
                            .put("clockSeconds",timeout).put("mode",if(payload.getString("format") == "duel") "duel" else if(DeckText.commander(payload.getString("format"))) "commander" else "constructed")
                            .put("bestOf",payload.optInt("bestOf",1)).put("sideboarding",payload.optInt("bestOf") == 3).put("maxMatchGames",5)
                        val result = ForgeClient.execute(this,request,run.id) { label,_ ->
                            if(store.get(run.id)?.state == "running") store.update(run.id,"running","Match ${unit+1}/$count · $label",completed.size)
                            notifyProgress("Match ${unit+1}/$count · $label")
                        }
                        val destination = store.file(run.id,"${unit.toString().padStart(5,'0')}-${System.currentTimeMillis()}.jsonl")
                        result.copyTo(destination); result.delete()
                        val events = destination.readLines().filter { it.isNotBlank() }.map { JSONObject(it) }
                        events.firstOrNull { it.optString("type") == "error" }?.let { error(it.optString("message")) }
                        val unitResult = events.firstOrNull { it.optString("type") == "result" }?.getJSONObject("result") ?: error("Forge returned no game evidence.")
                        if (unitResult.optString("termination") !in listOf("normal","rule_draw")) error("Match ${unit+1} ${unitResult.optString("termination").replace('_',' ')}. Review its evidence or resume with a longer timeout (up to 300 seconds).")
                        completed += unit; store.update(run.id,"running","Saved ${completed.size}/$count matches",completed.size)
                        if(wake.isHeld) wake.release()
                    }
                    if (store.get(run.id)?.state == "running") store.update(run.id,"complete","All requested matches have recorded outcomes",count)
                } catch (error: Throwable) {
                    if (store.get(run.id)?.state == "running") store.update(run.id,"failed",error.message ?: "The local engine stopped.")
                } finally { ForgeClient.cancel(run.id); if(wake.isHeld) wake.release() }
            }
        } finally { currentId=""; if(wake.isHeld) wake.release()
            withContext(NonCancellable + Dispatchers.Main) {
                runner=null
                if(store.next() != null) runner=scope.launch { processQueue() }
                else { stopForeground(STOP_FOREGROUND_REMOVE);stopSelf() }
            } }
    }
    override fun onBind(intent: Intent?) = null
    override fun onDestroy() { if(currentId.isNotEmpty()) { ForgeClient.cancel(currentId); store.get(currentId)?.let { if(it.state == "running") store.update(currentId,"interrupted","Android stopped the analysis. Resume to continue.") } }; scope.cancel();store.close(); super.onDestroy() }
    override fun onTimeout(startId: Int, fgsType: Int) { if(currentId.isNotEmpty()) ForgeClient.cancel(currentId);stopSelf() }
}
