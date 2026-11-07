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

private class EngineConnection(private val slot: Int) {
    private val mutex = Mutex()
    private val pid = AtomicInteger(0)
    @Volatile private var owner = ""
    @Volatile private var cancelled = false
    fun pidFor(id: String)=if(owner==id) pid.get() else 0
    @Volatile private var remote: Messenger?=null
    fun release(id: String) { if(owner==id) runCatching { remote?.send(Message.obtain(null,6)) } }
    fun cancel(id: String) { if (owner == id) { cancelled=true;pid.getAndSet(0).takeIf { it > 0 }?.let { Process.killProcess(it) } } }
    suspend fun execute(context: Context, request: JSONObject, id: String, onGame: (JSONObject) -> Unit = {}, onMetrics: (JSONObject) -> Unit = {}, onReady: () -> Unit = {}, progress: (String, Float?) -> Unit): File = mutex.withLock {
        owner = id;cancelled=false
        request.put("diagnosticRunId",id)
        Diagnostics.event("engine.request","Starting a local engine request",id,details=JSONObject().put("operation",request.optString("operation","simulate")).put("clockSeconds",request.optInt("clockSeconds")).put("bestOf",request.optInt("bestOf",1)))
        val directory = File(context.filesDir, "ipc").apply { mkdirs() }
        val input = File(directory, UUID.randomUUID().toString() + ".json")
        withContext(Dispatchers.IO) { input.writeText(request.toString()) }
        var connection: ServiceConnection? = null
        var engineBinder: IBinder? = null
        val stopped = CompletableDeferred<Unit>()
        try {
            withTimeout(if ((request.has("decks") || request.has("rawDecks"))) (request.optInt("clockSeconds", 120) * (if(request.optInt("bestOf") == 3) 5 else 1) + 180) * 1000L else 600000L) {
                suspendCancellableCoroutine<File> { continuation ->
                    val handler = Messenger(object : Handler(Looper.getMainLooper()) {
                        override fun handleMessage(message: Message) {
                            if(!continuation.isActive) return
                            pid.set(message.data.getInt("pid"))
                            if(cancelled) { this@EngineConnection.cancel(id);continuation.resumeWith(Result.failure(IllegalStateException("Operation cancelled")));return }
                            val value = message.data.getString("value") ?: return
                            when (message.what) {
                                1 -> progress(value, message.data.getFloat("fraction").takeIf { it >= 0 })
                                5 -> onMetrics(JSONObject(value))
                                6 -> onReady()
                                4 -> runCatching { onGame(JSONObject(value)) }.onFailure { Diagnostics.event("game.timing_error","Could not save live game timing",id,level="ERROR",error=it) }
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
                            engineBinder=binder
                            remote=Messenger(binder)
                            Diagnostics.event("engine.bound","Connected to local Forge service",id)
                            try { binder.linkToDeath({ stopped.complete(Unit) },0) } catch(_:RemoteException) { stopped.complete(Unit) }
                            try { Messenger(binder).send(Message.obtain(null, 1).apply { replyTo = handler; data = Bundle().apply { putString("path", input.absolutePath) } }) }
                            catch (error: Exception) { if (continuation.isActive) continuation.resumeWith(Result.failure(error)) }
                        }
                        override fun onServiceDisconnected(name: ComponentName) { if (continuation.isActive) {
                            Diagnostics.event("engine.disconnected",if(cancelled) "Engine stopped following cancellation" else "Engine process disconnected before returning a result",id,level=if(cancelled) "INFO" else "ERROR",details=JSONObject().put("pid",pid.get()))
                            continuation.resumeWith(Result.failure(IllegalStateException("Forge stopped. The phone may have run out of memory, or this run was cancelled.")))
                        } }
                        override fun onBindingDied(name: ComponentName) = onServiceDisconnected(name)
                        override fun onNullBinding(name: ComponentName) = onServiceDisconnected(name)
                    }
                    if (!context.bindService(Intent(context,EngineSlots.classes[slot]), connection!!, Context.BIND_AUTO_CREATE)) continuation.resumeWith(Result.failure(IllegalStateException("Could not start local Forge")))
                    continuation.invokeOnCancellation { this@EngineConnection.cancel(id) }
                }
            }
        } catch(error:Throwable) {
            Diagnostics.event("engine.request_failed",error.message ?: "Engine request failed",id,level=if(cancelled) "INFO" else "ERROR",error=error)
            throw error
        } finally {
            Diagnostics.event("engine.retired","Disposing the engine process after this request",id,details=JSONObject().put("pid",pid.get()).put("cancelled",cancelled))
            withContext(NonCancellable + Dispatchers.Main) { connection?.let { try { context.unbindService(it) } catch (_: IllegalArgumentException) { } }; this@EngineConnection.cancel(id); owner = "";remote=null }
            withContext(NonCancellable) { if(engineBinder != null) withTimeoutOrNull(3000) { stopped.await() } }
            input.delete()
            directory.listFiles { file -> file.name.startsWith(input.name + ".") && file.name.endsWith(".dck") }?.forEach { it.delete() }
        }
    }
}


/** Each lease owns a distinct Android process; Forge globals are never shared between games. */
object ForgeClient {
    private val connections=List(CapacityMath.MAX_ENGINES) { EngineConnection(it) }
    private val leaseMutex=Mutex()
    private val owners=arrayOfNulls<String>(CapacityMath.MAX_ENGINES)
    private val budgets=LongArray(CapacityMath.MAX_ENGINES)
    private val generations=java.util.concurrent.ConcurrentHashMap<String,java.util.concurrent.atomic.AtomicLong>()
    fun cancel(id: String) { generations.getOrPut(id) { java.util.concurrent.atomic.AtomicLong() }.incrementAndGet();connections.forEach { it.cancel(id) } }
    fun releaseBenchmark(id: String) { connections.forEach { it.release(id) } }
    fun activePids(context: Context,id: String): List<Int> = connections.map { it.pidFor(id) }.filter { it>0 }
    suspend fun execute(context: Context,request: JSONObject,id: String,onGame: (JSONObject)->Unit={},onMetrics: (JSONObject)->Unit={},onReady: ()->Unit={},allowed: ()->Boolean={true},progress: (String,Float?)->Unit): File {
        val counter=generations.getOrPut(id) { java.util.concurrent.atomic.AtomicLong() };val generation=counter.get()
        val profile=PerformanceSettings.profile(request.optString("format"),request.optJSONArray("rawDecks")?.length() ?: 4)
        val budget=PerformanceSettings.processBudgetMiB(context,profile)
        var slot=-1
        try {
        withTimeout(180000) {
            while(slot<0) {
                currentCoroutineContext().ensureActive()
                if(counter.get()!=generation || !allowed()) throw CancellationException("Request cancelled before an engine became available")
                slot=leaseMutex.withLock {
                    val resources=PerformanceSettings.resources(context)
                    val ceiling=if(request.optInt("benchmarkParallelism")>0) minOf(request.getInt("benchmarkParallelism"),CapacityMath.cpuLimit(resources.getInt("cores"))) else PerformanceSettings.limit(context,profile)
                    val count=owners.count { it!=null }
                    if(resources.getBoolean("lowMemory") || resources.getInt("thermal")>=PowerManager.THERMAL_STATUS_SEVERE) {
                        if(count==0) error("The device needs more free memory or time to cool before another game can start.")
                        -1
                    } else if(count>=ceiling) -1 else {
                        val manager=context.getSystemService(android.app.ActivityManager::class.java)
                        var reserved=0L
                        for(index in owners.indices) if(owners[index]!=null) {
                            val pid=connections[index].pidFor(owners[index]!!)
                            val used=if(pid>0) runCatching { manager.getProcessMemoryInfo(intArrayOf(pid))[0].totalPss/1024L }.getOrDefault(0) else 0L
                            reserved+=(budgets[index]-used).coerceAtLeast(0)
                        }
                        if(resources.getLong("availableMiB")-CapacityMath.reserveMiB(resources.getLong("totalMiB"))-reserved<budget) {
                            if(count==0) error("Not enough free memory for a Forge process. Close other apps and try again.")
                            -1
                        } else owners.indices.firstOrNull { owners[it]==null }?.also { owners[it]=id;budgets[it]=budget } ?: -1
                    }
                }
                if(slot<0) delay(200)
            }
        }
            if(counter.get()!=generation || !allowed()) throw CancellationException("Request cancelled")
            Diagnostics.event("engine.leased","Allocated an isolated engine process",id,details=JSONObject().put("slot",slot).put("budgetMiB",budget))
            return connections[slot].execute(context,request,id,onGame,onMetrics,onReady,progress)
        } finally { withContext(NonCancellable) { leaseMutex.withLock { if(slot>=0) {owners[slot]=null;budgets[slot]=0} } } }
    }
}
