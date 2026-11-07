package com.acocalypso.magictester

import android.content.*
import android.os.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

object ForgeClient {
    private val mutex = Mutex()
    private val pid = AtomicInteger(0)
    @Volatile private var owner = ""
    @Volatile private var cancelled = false
    fun cancel(id: String) { if (owner == id) { cancelled=true;pid.getAndSet(0).takeIf { it > 0 }?.let { Process.killProcess(it) } } }
    suspend fun execute(context: Context, request: JSONObject, id: String, progress: (String, Float?) -> Unit): File = mutex.withLock {
        owner = id;cancelled=false
        val directory = File(context.filesDir, "ipc").apply { mkdirs() }
        val input = File(directory, UUID.randomUUID().toString() + ".json")
        withContext(Dispatchers.IO) { input.writeText(request.toString()) }
        var connection: ServiceConnection? = null
        try {
            withTimeout(if ((request.has("decks") || request.has("rawDecks"))) (request.optInt("clockSeconds", 120) * (if(request.optInt("bestOf") == 3) 5 else 1) + 180) * 1000L else 600000L) {
                suspendCancellableCoroutine<File> { continuation ->
                    val handler = Messenger(object : Handler(Looper.getMainLooper()) {
                        override fun handleMessage(message: Message) {
                            if(!continuation.isActive) return
                            pid.set(message.data.getInt("pid"))
                            if(cancelled) { ForgeClient.cancel(id);continuation.resumeWith(Result.failure(IllegalStateException("Operation cancelled")));return }
                            val value = message.data.getString("value") ?: return
                            when (message.what) {
                                1 -> progress(value, message.data.getFloat("fraction").takeIf { it >= 0 })
                                2 -> if (continuation.isActive) continuation.resumeWith(Result.success(File(value)))
                                3 -> if (continuation.isActive) {
                                    val diagnostic=JSONObject(File(value).readText()).optString("error","Forge failed")
                                    continuation.resumeWith(Result.failure(IllegalStateException(diagnostic.lineSequence().first().removePrefix("java.lang.IllegalArgumentException: ").removePrefix("java.lang.IllegalStateException: "))))
                                }
                            }
                        }
                    })
                    connection = object : ServiceConnection {
                        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
                            try { Messenger(binder).send(Message.obtain(null, 1).apply { replyTo = handler; data = Bundle().apply { putString("path", input.absolutePath) } }) }
                            catch (error: Exception) { if (continuation.isActive) continuation.resumeWith(Result.failure(error)) }
                        }
                        override fun onServiceDisconnected(name: ComponentName) { if (continuation.isActive) continuation.resumeWith(Result.failure(IllegalStateException("Forge stopped. The phone may have run out of memory, or this run was cancelled."))) }
                        override fun onBindingDied(name: ComponentName) = onServiceDisconnected(name)
                        override fun onNullBinding(name: ComponentName) = onServiceDisconnected(name)
                    }
                    if (!context.bindService(Intent(context, EngineService::class.java), connection!!, Context.BIND_AUTO_CREATE)) continuation.resumeWith(Result.failure(IllegalStateException("Could not start local Forge")))
                    continuation.invokeOnCancellation { ForgeClient.cancel(id) }
                }
            }
        } finally {
            withContext(NonCancellable + Dispatchers.Main) { connection?.let { try { context.unbindService(it) } catch (_: IllegalArgumentException) { } }; ForgeClient.cancel(id); owner = "" }
            input.delete()
            directory.listFiles { file -> file.name.startsWith(input.name + ".") && file.name.endsWith(".dck") }?.forEach { it.delete() }
        }
    }
}
