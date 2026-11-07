package com.acocalypso.magictester

import android.app.Service
import android.content.Intent
import android.os.*
import org.json.JSONObject
import org.magictester.engine.AndroidForgeBridge
import java.io.File
import java.util.concurrent.Executors

/** Forge owns a disposable ART process. IPC carries paths, never large action logs. */
class EngineService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val messenger = Messenger(object : Handler(Looper.getMainLooper()) {
        override fun handleMessage(message: Message) {
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
                try {
                    val request = JSONObject(requestFile.readText())
                    val requestRunId=request.optString("diagnosticRunId","engine")
                    runId=requestRunId
                    console=Diagnostics.captureConsole(this@EngineService,requestRunId)
                    Diagnostics.event("engine.started","Forge process is preparing the request",runId,details=DiagnosticExporter.device(this@EngineService))
                    var lastProgress=""
                    var lastBucket=-1
                    val home = EngineAssets.install(this@EngineService) { label, fraction ->
                        send(1,label,fraction ?: -1f)
                        val stage=label.substringBefore('·').trim();val bucket=((fraction ?: -1f)*10).toInt()
                        if(stage!=lastProgress || bucket!=lastBucket) { Diagnostics.event("engine.setup_progress",label,runId);lastProgress=stage;lastBucket=bucket }
                    }
                    AndroidForgeBridge.initialize(home.absolutePath) { send(1,it);Diagnostics.event("engine.initialized",it,runId) }
                    if (request.optString("operation") == "validate") {
                        val result = EngineValidation.validate(request.getString("text"), request.getString("format"), File(path + ".dck"))
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
                            AndroidForgeBridge.execute(request.toString()) { event -> writer.appendLine(event); writer.flush(); val json = JSONObject(event)
                                when(json.optString("type")) {
                                    "game_started" -> Diagnostics.event("game.started","Forge started an observed game",runId,details=JSONObject().put("unit",json.optInt("index")).put("game",json.optInt("gameIndex")).put("gameSeed",json.optInt("gameSeed")))
                                    "result" -> { val result=json.getJSONObject("result");val termination=result.optString("termination");if(termination !in listOf("normal","rule_draw")) Diagnostics.threadDump(this@EngineService,requestRunId);Diagnostics.event("game.result","Game/match finished: $termination",runId,level=if(termination in listOf("normal","rule_draw")) "INFO" else "ERROR",details=JSONObject().put("unit",result.optInt("index")).put("termination",termination).put("durationMs",result.optLong("durationMs")).put("turns",result.optInt("turns")).put("clockSeconds",request.optInt("clockSeconds"))) }
                                    "error" -> Diagnostics.event("game.error",json.optString("message","Forge reported an error"),runId,level="ERROR")
                                }
                                if (json.optString("type") == "game_started") send(1, "Playing game ${json.optInt("gameIndex") + 1}") }
                        }
                    }
                    send(2, resultFile.absolutePath)
                } catch (error: Throwable) {
                    Diagnostics.event("engine.error",error.message ?: "Forge process failed",runId,level="ERROR",error=error)
                    error.printStackTrace()
                    resultFile.writeText(JSONObject().put("error", error.stackTraceToString().take(16000)).toString())
                    send(3, resultFile.absolutePath)
                } finally { console?.restore() }
            }
        }
    })
    override fun onBind(intent: Intent) = messenger.binder
    override fun onDestroy() { executor.shutdownNow(); super.onDestroy() }
}
