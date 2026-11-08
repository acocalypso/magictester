package com.acocalypso.magictester

import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/** A timeout ends one isolated match, not the finite queue of scheduled matches. */
object AnalysisRunner {
    suspend fun run(store: RunStore,run: Run,parallelism: ()->Int,execute: suspend (Int)->File,progress: (String)->Unit={}) {
        val total=run.payload.getInt("games")
        val done=store.successfulIndices(run.id).filter {it in 0 until total}.toSet()
        val count=AtomicInteger(done.size)
        val pending=(0 until total).filter {it !in done}.toMutableList()
        while(pending.isNotEmpty() && store.get(run.id)?.state=="running") {
            currentCoroutineContext().ensureActive()
            val limit=parallelism().coerceAtLeast(1)
            val wave=pending.take(limit);repeat(wave.size) {pending.removeAt(0)}
            Diagnostics.event("parallel.wave","Scheduling ${wave.size} isolated matches",run.id,details=JSONObject().put("effectiveLimit",limit))
            val outcomes=supervisorScope {wave.map {unit->async {
                runCatching {
                    if(store.get(run.id)?.state!="running")return@runCatching
                    val result=execute(unit)
                    val destination=try {store.saveAttempt(run.id,result,unit)} finally {result.delete()}
                    if(destination==null)return@runCatching
                    val events=destination.readLines().filter {it.isNotBlank()}.map {JSONObject(it)}
                    events.firstOrNull {it.optString("type")=="error"}?.let {error(it.optString("message"))}
                    val outcome=events.firstOrNull {it.optString("type")=="result"}?.getJSONObject("result") ?: error("Forge returned no game evidence")
                    require(outcome.optInt("index",-1)==unit) {"Forge returned evidence for an unexpected match"}
                    val termination=outcome.optString("termination")
                    val label=when(termination) {
                        "normal","rule_draw" -> "Saved ${count.incrementAndGet()}/$total finished matches"
                        "timeout" -> {
                            Diagnostics.event("match.timeout_continued","Match ${unit+1} timed out. Its evidence is saved; later scheduled matches will continue.",run.id,level="WARN",details=JSONObject().put("unit",unit).put("clockSeconds",outcome.optInt("clockSeconds")))
                            "Match ${unit+1} timed out · ${count.get()}/$total finished · continuing scheduled matches"
                        }
                        else -> error("Match ${unit+1}: ${termination.replace('_',' ')}. Review evidence and diagnostic logs before resuming.")
                    }
                    store.update(run.id,"running",label,count.get(),onlyIfRunning=true);progress(label)
                }
            }}.awaitAll()}
            currentCoroutineContext().ensureActive()
            outcomes.firstOrNull {it.isFailure}?.exceptionOrNull()?.let {throw it}
        }
        val finished=count.get()
        val incomplete=finished<total
        store.update(run.id,if(incomplete) "incomplete" else "complete",
            if(incomplete) "Scheduled matches attempted · $finished/$total finished · ${total-finished} unfinished. Retry unfinished matches with a longer limit."
            else "All requested matches have recorded outcomes",finished,onlyIfRunning=true)
    }
}
