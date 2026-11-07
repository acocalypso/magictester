package com.acocalypso.magictester

import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Opt-in real four-player workload; excluded from the short release acceptance workload. */
class CommanderDurationTest {
    @Test fun measureUserElvesDeckAgainstThreeTournamentOpponents() = runBlocking {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val args=InstrumentationRegistry.getArguments()
        assumeTrue("Run through Android Commander timing workflow",args.getString("commanderTiming")=="true")
        val samples=(args.getString("timingSamples") ?: "5").toInt().also {require(it in 1..20)}
        val clock=(args.getString("timingClockSeconds") ?: "1800").toInt().also {require(it in 300..3600)}
        val context=instrumentation.targetContext
        val workload=JSONObject(instrumentation.context.assets.open("commander-timing.json").bufferedReader().use {it.readText()})
        val opponents=workload.getJSONArray("opponents")
        assertEquals(3,opponents.length())
        val texts=listOf(workload.getJSONObject("deck").getString("text"))+(0 until 3).map {opponents.getJSONObject(it).getString("text")}
        val observations=JSONArray()
        val report=JSONObject().put("workload",workload).put("device",DiagnosticExporter.device(context))
            .put("engineVersion",BuildConfig.FORGE_VERSION).put("players",4).put("parallelism",1).put("clockSeconds",clock).put("requestedSamples",samples).put("observations",observations)
        val output=File(context.filesDir,"commander-duration.json")
        val evidence=File(context.filesDir,"commander-timing").apply {mkdirs()}
        fun save() {
            val durations=(0 until observations.length()).map {observations.getJSONObject(it)}.filter {it.getString("termination") in listOf("normal","rule_draw")}.map {it.getLong("durationMs")}.sorted()
            report.put("completedGames",durations.size).put("timeouts",(0 until observations.length()).count {observations.getJSONObject(it).getString("termination")=="timeout"})
                .put("averageCompletedMs",if(durations.isEmpty()) JSONObject.NULL else durations.average())
                .put("medianCompletedMs",if(durations.isEmpty()) JSONObject.NULL else if(durations.size%2==1) durations[durations.size/2].toDouble() else (durations[durations.size/2-1]+durations[durations.size/2])/2.0)
                .put("maximumCompletedMs",durations.lastOrNull() ?: JSONObject.NULL)
                .put("note","Completed-game statistics exclude timeouts and errors. With timeouts, the completed-only mean underestimates the full workload. Emulator timings do not predict a particular phone.")
            output.writeText(report.toString(2))
        }
        ActivityScenario.launch(MainActivity::class.java).use {
            report.put("legality",CurrentLegality(context).check(texts,"commander"))
            save()
            for(index in 0 until samples) {
                val seed=24681357+index*1009
                val request=JSONObject().put("rawDecks",JSONArray(texts)).put("format","commander").put("mode","commander")
                    .put("games",1).put("seed",seed).put("clockSeconds",clock).put("bestOf",1).put("maxMatchGames",1)
                val started=android.os.SystemClock.elapsedRealtime()
                try {
                    val file=ForgeClient.execute(context,request,"commander-duration") {label,_ -> println("Timing sample ${index+1}/$samples: $label")}
                    val result=try {file.copyTo(File(evidence,"sample-${index+1}.jsonl"),overwrite=true);file.useLines {lines -> lines.filter {it.isNotBlank()}.map {JSONObject(it)}.first {it.optString("type")=="result"}.getJSONObject("result")}} finally {file.delete()}
                    val observation=JSONObject().put("sample",index+1).put("seed",seed).put("termination",result.getString("termination"))
                        .put("durationMs",result.getLong("durationMs")).put("wallWithInitializationMs",android.os.SystemClock.elapsedRealtime()-started)
                        .put("resourcesAfterGame",PerformanceSettings.resources(context)).put("turns",result.opt("turns")).put("winner",result.opt("winner"))
                    observations.put(observation);save();println("COMMANDER_TIMING $observation")
                    assertTrue(result.toString().take(1000),result.getString("termination") in listOf("normal","rule_draw","timeout"))
                } catch(error:Exception) {
                    report.put("error",error.stackTraceToString());save();throw error
                }
            }
        }
        report.put("finished",true);save()
        println("COMMANDER_TIMING_SUMMARY ${report.toString()}")
    }
}
