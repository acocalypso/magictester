package com.acocalypso.magictester

import android.app.Service
import android.content.Intent
import android.os.*
import org.json.JSONObject
import org.magictester.engine.AndroidForgeBridge
import java.io.File
import java.util.concurrent.Executors

/** Forge owns a disposable ART process. IPC carries paths, never large action logs. */
open class EngineService : Service() {
    @Volatile private var startGate: java.util.concurrent.CountDownLatch?=null
    private val executor = Executors.newSingleThreadExecutor()
    private val messenger = Messenger(object : Handler(Looper.getMainLooper()) {
        override fun handleMessage(message: Message) {
            if(message.what==6) { startGate?.countDown();return }
            if (message.what == 9) { Process.killProcess(Process.myPid()); return }
            val reply = message.replyTo ?: return
            val path = message.data.getString("path") ?: return
            fun send(what: Int, value: String, fraction: Float = -1f) {
                try { reply.send(Message.obtain(null, what).apply { data = Bundle().apply { putString("value", value); putFloat("fraction", fraction); putInt("pid", Process.myPid()) } }) } catch (_: RemoteException) { Process.killProcess(Process.myPid()) }
            }
            send(1, "Preparing local Forge engine")
            executor.execute {
                val requestFile = File(path)
                val resultFile = File(path + ".result")
                var runId: String?=null
                var console: Diagnostics.ConsoleCapture?=null
                val peakPss=java.util.concurrent.atomic.AtomicLong()
                val sampler=java.util.concurrent.Executors.newSingleThreadScheduledExecutor()
                fun sample() { runCatching { val pss=Debug.getPss();peakPss.updateAndGet { maxOf(it,pss) } } }
                sampler.scheduleAtFixedRate({sample()},0,1,java.util.concurrent.TimeUnit.SECONDS)
                fun metrics() { sample();send(5,JSONObject().put("pid",Process.myPid()).put("peakPssKiB",peakPss.get()).put("heapUsedMiB",(Runtime.getRuntime().totalMemory()-Runtime.getRuntime().freeMemory())/1048576).toString()) }
                try {
                    val request = JSONObject(requestFile.readText())
                    val engineBuild=EngineBuild.fingerprint(this@EngineService)
                    EngineBuild.requireExpected(request.optString("expectedEngineBuildSha256"),engineBuild)
                    val requestRunId=request.optString("diagnosticRunId","engine")
                    runId=requestRunId
                    console=Diagnostics.captureConsole(this@EngineService,requestRunId)
                    Diagnostics.event("engine.started","Forge process is preparing the request",runId,details=DiagnosticExporter.device(this@EngineService))
                    var lastProgress=""
                    var lastBucket=-1
                    var lastSent=0L
                    val home = EngineAssets.install(this@EngineService) { label, fraction ->
                        val stage=label.substringBefore('·').trim();val bucket=((fraction ?: -1f)*10).toInt()
                        val now=SystemClock.elapsedRealtime()
                        if(stage!=lastProgress || now-lastSent>=250 || fraction==1f) {send(1,label,fraction ?: -1f);lastSent=now}
                        if(stage!=lastProgress || bucket!=lastBucket) { Diagnostics.event("engine.setup_progress",label,runId);lastProgress=stage;lastBucket=bucket }
                    }
                    AndroidForgeBridge.initialize(home.absolutePath) { send(1,it);Diagnostics.event("engine.initialized",it,runId) }
                    if(request.optBoolean("benchmarkBarrier")) {
                        startGate=java.util.concurrent.CountDownLatch(1)
                        send(6,"Engine ready for benchmark")
                        check(startGate!!.await(120,java.util.concurrent.TimeUnit.SECONDS)) { "Other benchmark engines could not become ready within the resource budget." }
                    }
                    if (request.optString("operation") == "validate") {
                        val texts=request.optJSONArray("texts")
                        val result=if(texts==null) EngineValidation.validate(request.getString("text"), request.getString("format"), File(path + ".dck")) else {
                            val results=org.json.JSONArray()
                            for(index in 0 until texts.length()) {
                                send(1,"Checking deck ${index+1} of ${texts.length()}")
                                results.put(EngineValidation.validate(texts.getString(index),request.getString("format"),File(path+".$index.dck")))
                            }
                            JSONObject().put("results",results)
                        }
                        resultFile.writeText(result.toString())
                    } else if (request.optString("operation") == "setup") {
                        resultFile.writeText(JSONObject().put("ready", true).put("engineVersion", BuildConfig.FORGE_VERSION).toString())
                    } else {
                        val rawDecks = request.optJSONArray("rawDecks")
                        if (rawDecks != null) {
                            val paths = org.json.JSONArray(); val companions = org.json.JSONArray()
                            for (index in 0 until rawDecks.length()) {
                                val deckFile = File(path + ".$index.dck")
                                val validation = EngineValidation.validate(rawDecks.getString(index), request.getString("format"), deckFile)
                                require(validation.getBoolean("valid")) { val errors=validation.getJSONArray("errors");"Deck ${index+1}: " + (0 until errors.length()).joinToString("; ") { errors.getString(it) } }
                                paths.put(deckFile.absolutePath); companions.put(validation.opt("companion"))
                            }
                            request.put("decks", paths).put("companions", companions)
                        }
                        resultFile.bufferedWriter().use { writer ->
                            AndroidForgeBridge.execute(request.toString()) { event ->
                                val json = JSONObject(event)
                                EngineBuild.annotate(json,engineBuild,BuildConfig.VERSION_NAME)
                                writer.appendLine(json.toString());writer.flush()
                                when(json.optString("type")) {
                                    "game_started" -> {
                                        json.put("startedAtEpochMs",System.currentTimeMillis()).put("startedElapsedMs",SystemClock.elapsedRealtime()).put("clockSeconds",request.optInt("clockSeconds"))
                                        send(4,json.toString())
                                        Diagnostics.event("game.started","Forge started an observed game",runId,details=JSONObject().put("unit",json.optInt("index")).put("game",json.optInt("gameIndex")).put("gameSeed",json.optInt("gameSeed")).put("clockSeconds",request.optInt("clockSeconds")))
                                    }
                                    "game_finished" -> { send(4,json.toString());Diagnostics.event("game.finished","Observed game finished",runId,details=json) }
                                    "result" -> { val result=json.getJSONObject("result");val termination=result.optString("termination");if(termination !in listOf("normal","rule_draw")) Diagnostics.threadDump(this@EngineService,requestRunId);Diagnostics.event("game.result","Game/match finished: $termination",runId,level=if(termination in listOf("normal","rule_draw")) "INFO" else "ERROR",details=JSONObject().put("unit",result.optInt("index")).put("termination",termination).put("durationMs",result.optLong("durationMs")).put("turns",result.optInt("turns")).put("clockSeconds",request.optInt("clockSeconds"))) }
                                    "error" -> Diagnostics.event("game.error",json.optString("message","Forge reported an error"),runId,level="ERROR")
                                }
                                if (json.optString("type") == "game_started") send(1, "Playing game ${json.optInt("gameIndex") + 1}") }
                        }
                    }
                    metrics()
                    send(2, resultFile.absolutePath)
                } catch (error: Throwable) {
                    Diagnostics.event("engine.error",error.message ?: "Forge process failed",runId,level="ERROR",error=error)
                    error.printStackTrace()
                    resultFile.writeText(JSONObject().put("error", error.stackTraceToString().take(16000)).toString())
                    metrics()
                    send(3, resultFile.absolutePath)
                } finally { startGate=null;sampler.shutdownNow();console?.restore() }
            }
        }
    })
    override fun onBind(intent: Intent) = messenger.binder
    override fun onDestroy() { executor.shutdownNow(); super.onDestroy() }
}

class EngineService1: EngineService()
class EngineService2: EngineService()
class EngineService3: EngineService()
object EngineSlots {
    val classes=listOf(EngineService::class.java,EngineService1::class.java,EngineService2::class.java,EngineService3::class.java)
}
