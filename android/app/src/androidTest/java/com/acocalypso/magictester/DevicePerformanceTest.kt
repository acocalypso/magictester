package com.acocalypso.magictester

import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*

class DevicePerformanceTest {
    @Test fun realBenchmarkValidatesTwoProcessesAndManualLimitRunsTwoMatches() = runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        context.getSharedPreferences("updates",0).edit().putString("latest",BuildConfig.FORGE_VERSION).putLong("checked",System.currentTimeMillis()).commit()
        ActivityScenario.launch(MainActivity::class.java).use {
            val store=RunStore(context)
            fun payload()=JSONObject().put("title","Parallel acceptance").put("deck",Examples.burn).put("format","pauper").put("games",20).put("clockSeconds",120).put("bestOf",1).put("players",2).put("seed",24681357).put("engineVersion",BuildConfig.FORGE_VERSION).put("opponents",JSONArray().put(JSONObject().put("name","Reference burn").put("text",Examples.burn)))
            suspend fun finished(id: String): Run {
                return withTimeout(700000) {
                    while(true) {
                        val run=store.get(id) ?: error("Acceptance run disappeared")
                        assertFalse(run.label,run.state in listOf("failed","interrupted"))
                        if(run.state=="complete") return@withTimeout run
                        delay(500)
                    }
                    error("unreachable")
                }
            }
            val benchmark=store.create(payload().put("kind","benchmark").put("benchmarkMax",2))
            ContextCompat.startForegroundService(context,Intent(context,QueueService::class.java))
            val result=finished(benchmark)
            val report=result.payload.getJSONObject("benchmarkReport")
            assertEquals(report.toString(),2,report.getInt("maxStable"))
            assertEquals(6,report.getInt("completedGames"))
            val stage=report.getJSONArray("samples").getJSONObject(1)
            assertTrue(stage.toString(),stage.getBoolean("stable"))
            assertEquals(2,stage.getInt("peakSimultaneousGames"))
            assertTrue(stage.getJSONArray("processIds").length()>=2)
            assertTrue(stage.getDouble("gamesPerMinute")>0)
            assertTrue(stage.getLong("peakProcessPssMiB")>0)
            PerformanceSettings.select(context,2)
            assertEquals(2,PerformanceSettings.limit(context,"constructed"))
            val analysis=store.create(payload().put("games",2))
            ContextCompat.startForegroundService(context,Intent(context,QueueService::class.java))
            val completed=finished(analysis)
            assertEquals(2,completed.completed)
            assertEquals(2,completed.liveGames.size)
            assertTrue(completed.liveGames.none {it.optBoolean("active")})
            assertEquals(2,store.successfulIndices(analysis).size)
            // Delete while actual engine processes are active; late callbacks must not restore the row.
            val removed=store.create(payload().put("games",2))
            ContextCompat.startForegroundService(context,Intent(context,QueueService::class.java))
            withTimeout(180000) { while(store.get(removed)?.liveGames?.none {it.optBoolean("active")}!=false) {delay(100)} }
            store.update(removed,"deleting","Removing analysis")
            ForgeClient.cancel(removed)
            assertTrue(store.delete(removed))
            withTimeout(10000) {while(ForgeClient.activePids(context,removed).isNotEmpty()) {delay(100)}}
            delay(1000)
            assertNull(store.get(removed))
            assertFalse(store.file(removed,"anything").parentFile!!.exists())
            store.close()
        }
    }
}
