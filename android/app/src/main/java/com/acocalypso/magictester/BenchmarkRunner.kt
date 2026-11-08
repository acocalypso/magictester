package com.acocalypso.magictester

import android.content.Context
import android.os.PowerManager
import android.os.SystemClock
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

object BenchmarkRunner {
    suspend fun run(context: Context,store: RunStore,run: Run,resourceSnapshot: ()->JSONObject={PerformanceSettings.resources(context)},monitorSnapshot: ()->JSONObject=resourceSnapshot,progress: (String)->Unit) {
        // A failed older benchmark may have reduced its display total to one saved game.
        // Every fresh calibration still needs all possible trial indices.
        val payload=JSONObject(run.payload.toString()).put("games",CapacityMath.MAX_ENGINES*(CapacityMath.MAX_ENGINES+1))
        require(payload.optString("aiPolicy",AiPolicy.STABLE)==AiPolicy.STABLE) {"Device calibration requires the native Forge AI policy. Start a new performance test."}
        val profile=PerformanceSettings.profile(payload.getString("format"),payload.optInt("players",4))
        val samples=JSONArray()
        val report=JSONObject().put("identity",PerformanceSettings.identity(context)).put("profile",profile).put("measuredAt",System.currentTimeMillis()).put("samples",samples).put("recommended",1).put("maxStable",0).put("processBudgetMiB",PerformanceSettings.processBudgetMiB(context,profile))
        store.updatePayload(run.id,JSONObject(payload.toString()).put("benchmarkReport",report))
        val maxLevel=minOf(CapacityMath.cpuLimit(Runtime.getRuntime().availableProcessors()),payload.optInt("benchmarkMax",CapacityMath.MAX_ENGINES))
        var completed=0;var index=0
        val successful=mutableListOf<Pair<Int,Double>>()
        fun save() {
            report.put("recommended",CapacityMath.recommendation(successful)).put("completedGames",completed)
            PerformanceSettings.save(context,profile,report)
            store.updatePayload(run.id,JSONObject(payload.toString()).put("benchmarkReport",JSONObject(report.toString())))
        }
        for(level in 1..maxLevel) {
            currentCoroutineContext().ensureActive()
            if(store.get(run.id)?.state!="running") break
            val resources=resourceSnapshot()
            val capacity=CapacityMath.candidates(resources.getLong("availableMiB"),resources.getLong("totalMiB"),PerformanceSettings.processBudgetMiB(context,profile),resources.getInt("cores"),resources.getBoolean("lowMemory"),resources.getInt("thermal"))
            if(capacity<level) { report.put("stoppedReason","Current capacity is $capacity engines: ${resources.getLong("availableMiB")} MiB available; thermal ${PerformanceSettings.thermalLabel(resources.getInt("thermal"))}; memory-pressure flag ${resources.getBoolean("lowMemory")}.").put("stopResources",resources);break }
            val started=SystemClock.elapsedRealtime()
            val active=ConcurrentHashMap.newKeySet<Int>()
            val peakActive=AtomicInteger(0)
            val pids=ConcurrentHashMap.newKeySet<Int>()
            val peakPss=java.util.concurrent.atomic.AtomicLong()
            val peakThermal=AtomicInteger(resources.getInt("thermal"))
            val reportedThrottle=java.util.concurrent.atomic.AtomicBoolean(false)
            val minimumFree=java.util.concurrent.atomic.AtomicLong(resources.getLong("availableMiB"))
            var failure: String?=null
            var stopResources: JSONObject?=null
            val stageStart=index
            progress("Benchmark: testing $level parallel engines")
            for(round in 0..1) {
                val ready=AtomicInteger(0)
                val outcomes=supervisorScope {
                    val monitor=launch {
                        while(isActive) {
                            val sample=monitorSnapshot()
                            val thermal=sample.getInt("thermal")
                            peakThermal.updateAndGet {maxOf(it,thermal)}
                            if(thermal==3 && reportedThrottle.compareAndSet(false,true)) Diagnostics.event("benchmark.thermal_throttling","Android reports severe thermal throttling. Already-started trials will finish; throughput includes throttling. Additional parallel processes wait until the advisory clears.",run.id,level="WARN",details=sample)
                            minimumFree.updateAndGet { minOf(it,sample.getLong("availableMiB")) }
                            if(CapacityMath.stopBenchmark(level,sample.getLong("availableMiB"),sample.getBoolean("lowMemory"),sample.getInt("thermal"))) {
                                failure="Android resource pressure: ${sample.getLong("availableMiB")} MiB available; thermal ${PerformanceSettings.thermalLabel(sample.getInt("thermal"))}; memory-pressure flag ${sample.getBoolean("lowMemory")}."
                                stopResources=JSONObject(sample.toString())
                                Diagnostics.event("benchmark.resource_stop",failure!!,run.id,level="WARN",details=stopResources)
                                ForgeClient.cancel(run.id);break
                            }
                            delay(1000)
                        }
                    }
                    try {
                        (0 until level).map { seat -> async {
                            runCatching {
                                val unit=stageStart+round*level+seat
                                val request=SimulationRequest.unit(payload,unit).put("benchmarkParallelism",level).put("benchmarkBarrier",true)
                                val file=ForgeClient.execute(context,request,run.id,onGame={ event ->
                                    store.gameEvent(run.id,event)
                                    if(event.optString("type")=="game_started") { active.add(unit);peakActive.updateAndGet { maxOf(it,active.size) } } else if(event.optString("type")=="game_finished") active.remove(unit)
                                },onMetrics={ metrics -> pids.add(metrics.getInt("pid"));peakPss.updateAndGet { maxOf(it,metrics.optLong("peakPssKiB")/1024) } },onReady={ if(ready.incrementAndGet()==level) ForgeClient.releaseBenchmark(run.id) },allowed={store.get(run.id)?.state=="running"},resourceSnapshot=resourceSnapshot) { label,_ ->progress("Benchmark $level engines · $label") }
                                try {
                                    val destination=store.saveAttempt(run.id,file,unit) ?: throw CancellationException("Benchmark cancelled")
                                    val events=destination.readLines().filter {it.isNotBlank()}.map {JSONObject(it)}
                                    val result=events.firstOrNull {it.optString("type")=="result"}?.getJSONObject("result") ?: error("No benchmark result returned")
                                    require(result.optString("termination") in listOf("normal","rule_draw")) { "A benchmark game ${result.optString("termination")}." }
                                } finally {file.delete()}
                            }
                        } }.awaitAll()
                    } finally {monitor.cancelAndJoin()}
                }
                completed+=outcomes.count {it.isSuccess}
                outcomes.firstOrNull {it.isFailure}?.exceptionOrNull()?.let { if(failure==null) failure=it.message ?: "Engine failed during benchmark" }
                store.update(run.id,"running","Benchmark $level engines: ${outcomes.count {it.isSuccess}}/$level games saved in round ${round+1}",completed,onlyIfRunning=true)
                if(failure!=null) break
            }
            index+=2*level
            val elapsed=SystemClock.elapsedRealtime()-started
            val expected=2*level
            val finished=store.successfulIndices(run.id).count {it in stageStart until stageStart+expected}
            val stable=failure==null && finished==expected && peakActive.get()>=level
            val rate=if(elapsed>0) finished*60000.0/elapsed else 0.0
            val sample=JSONObject().put("parallelism",level).put("completed",finished).put("expected",expected).put("elapsedMs",elapsed).put("gamesPerMinute",rate)
                .put("peakSimultaneousGames",peakActive.get()).put("processIds",JSONArray(pids.toList())).put("peakProcessPssMiB",peakPss.get()).put("minimumFreeMemoryMiB",minimumFree.get()).put("stable",stable)
                .put("reason",failure ?: if(!stable) "The requested games did not overlap; this concurrency level was not validated." else "All real games completed with overlapping engine processes."+if(peakThermal.get()>=3) " Android reported ${PerformanceSettings.thermalLabel(peakThermal.get())}; measured throughput includes throttling." else "")
                .put("peakThermalStatus",peakThermal.get()).put("thermalThrottlingObserved",peakThermal.get()>=3)
            stopResources?.let {sample.put("stopResources",it)}
            samples.put(sample)
            if(stable) { successful+=level to rate;report.put("maxStable",level);report.put("processBudgetMiB",maxOf(384L,(peakPss.get()*1.3).toLong())) }
            save()
            Diagnostics.event("benchmark.stage",sample.getString("reason"),run.id,level=if(stable) "INFO" else "WARN",details=sample)
            if(!stable) break
        }
        save()
        val maxStable=report.optInt("maxStable")
        if(store.get(run.id)?.state=="running") {
            val recordedTotal=store.results(run.id).maxOfOrNull {it.optInt("index")+1} ?: 0
            val finalPayload=JSONObject(store.get(run.id)!!.payload.toString()).put("games",maxOf(1,completed,recordedTotal)).put("benchmarkReport",report)
            store.updatePayload(run.id,finalPayload)
            store.update(run.id,if(maxStable>0) "complete" else "failed",if(maxStable>0) "Benchmark complete: recommended ${report.getInt("recommended")}; highest validated $maxStable parallel engines." else "Benchmark stopped: ${if(samples.length()>0) samples.getJSONObject(samples.length()-1).optString("reason") else report.optString("stoppedReason","No stable level completed. Export diagnostic logs.")}",completed,onlyIfRunning=true)
        }
    }
}
