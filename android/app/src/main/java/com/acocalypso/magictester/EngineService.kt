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
                try {
                    val request = JSONObject(requestFile.readText())
                    val home = EngineAssets.install(this@EngineService) { label, fraction -> send(1, label, fraction ?: -1f) }
                    AndroidForgeBridge.initialize(home.absolutePath) { send(1, it) }
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
                                require(validation.getBoolean("valid")) { "Deck ${index+1}: ${validation.getJSONArray("errors")}" }
                                paths.put(deckFile.absolutePath); companions.put(validation.opt("companion"))
                            }
                            request.put("decks", paths).put("companions", companions)
                        }
                        resultFile.bufferedWriter().use { writer ->
                            AndroidForgeBridge.execute(request.toString()) { event -> writer.appendLine(event); writer.flush(); val json = JSONObject(event); if (json.optString("type") == "game_started") send(1, "Playing game ${json.optInt("gameIndex") + 1}") }
                        }
                    }
                    send(2, resultFile.absolutePath)
                } catch (error: Throwable) {
                    resultFile.writeText(JSONObject().put("error", error.stackTraceToString().take(16000)).toString())
                    send(3, resultFile.absolutePath)
                }
            }
        }
    })
    override fun onBind(intent: Intent) = messenger.binder
    override fun onDestroy() { executor.shutdownNow(); super.onDestroy() }
}
