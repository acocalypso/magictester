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
    suspend fun run(context: Context,store: RunStore,run: Run,progress: (String)->Unit) {
        val payload=run.payload
        val profile=PerformanceSettings.profile(payload.getString("format"),payload.optInt("players",4))
        val samples=JSONArray()
        val report=JSONObject().put("identity",PerformanceSettings.identity(context)).put("profile",profile).put("measuredAt",System.currentTimeMillis()).put("samples",samples).put("recommended",1).put("maxStable",0).put("processBudgetMiB",PerformanceSettings.processBudgetMiB(context,profile))
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
            val resources=PerformanceSettings.resources(context)
            val capacity=PerformanceSettings.candidates(context,profile)
            if(capacity<level) { report.put("stoppedReason","Available memory/CPU/thermal limits allow $capacity engines now.");break }
            val started=SystemClock.elapsedRealtime()
            val active=ConcurrentHashMap.newKeySet<Int>()
            val peakActive=AtomicInteger(0)
            val pids=ConcurrentHashMap.newKeySet<Int>()
            val peakPss=java.util.concurrent.atomic.AtomicLong()
            val minimumFree=java.util.concurrent.atomic.AtomicLong(resources.getLong("availableMiB"))
            var failure: String?=null
            val stageStart=index
            progress("Benchmark: testing $level parallel engines")
            for(round in 0..1) {
                val ready=AtomicInteger(0)
                val outcomes=supervisorScope {
                    val monitor=launch {
                        while(isActive) {
                            val sample=PerformanceSettings.resources(context)
                            minimumFree.updateAndGet { minOf(it,sample.getLong("availableMiB")) }
                            if(sample.getBoolean("lowMemory") || sample.getInt("thermal")>=PowerManager.THERMAL_STATUS_SEVERE) { failure="Android reported memory or thermal pressure.";ForgeClient.cancel(run.id);break }
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
                                },onMetrics={ metrics -> pids.add(metrics.getInt("pid"));peakPss.updateAndGet { maxOf(it,metrics.optLong("peakPssKiB")/1024) } },onReady={ if(ready.incrementAndGet()==level) ForgeClient.releaseBenchmark(run.id) },allowed={store.get(run.id)?.state=="running"}) { label,_ ->progress("Benchmark $level engines · $label") }
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
                outcomes.firstOrNull {it.isFailure}?.exceptionOrNull()?.let { failure=it.message ?: "Engine failed during benchmark" }
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
                .put("reason",failure ?: if(!stable) "The requested games did not overlap; this concurrency level was not validated." else "All real games completed with overlapping engine processes.")
            samples.put(sample)
            if(stable) { successful+=level to rate;report.put("maxStable",level);report.put("processBudgetMiB",maxOf(384L,(peakPss.get()*1.3).toLong())) }
            save()
            Diagnostics.event("benchmark.stage",sample.getString("reason"),run.id,level=if(stable) "INFO" else "WARN",details=sample)
            if(!stable) break
        }
        save()
        val maxStable=report.optInt("maxStable")
        if(store.get(run.id)?.state=="running") {
            val finalPayload=JSONObject(store.get(run.id)!!.payload.toString()).put("games",maxOf(1,completed)).put("benchmarkReport",report)
            store.updatePayload(run.id,finalPayload)
            store.update(run.id,if(maxStable>0) "complete" else "failed",if(maxStable>0) "Benchmark complete: recommended ${report.getInt("recommended")}; highest validated $maxStable parallel engines." else "No stable benchmark level completed. Review diagnostic logs.",completed,onlyIfRunning=true)
        }
    }
}
