package com.acocalypso.magictester

import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*

class ResourceAdmissionTest {
    @get:Rule val visibleWorkbench=ActivityScenarioRule(MainActivity::class.java)
    @Test fun realSetupAllowsOneProcessUnderAdvisoriesButRejectsCriticalThermalStatus() = runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val id="advisory-setup-test"
        val file=ForgeClient.execute(context,JSONObject().put("operation","setup"),id,resourceSnapshot={
            PerformanceSettings.resources(context).put("lowMemory",true).put("thermal",3)
        }) {_,_->}
        try {assertTrue(JSONObject(file.readText()).getBoolean("ready"))} finally {file.delete()}
        try {
            ForgeClient.execute(context,JSONObject().put("operation","setup"),id,resourceSnapshot={
                PerformanceSettings.resources(context).put("thermal",4)
            }) {_,_->}
            fail("Critical thermal status must stop startup")
        } catch(error:IllegalStateException) {
            assertTrue(error.message.orEmpty(),error.message.orEmpty().contains("critical"))
            assertTrue(error.message.orEmpty().contains("set up Forge"))
        }
        assertTrue(ForgeClient.activePids(context,id).isEmpty())
    }
    @Test fun realCalibrationFinishesStartedParallelTrialsAndRecordsSevereThermalReports() = runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val store=RunStore(context)
        // Reproduce the display total saved by the failed 0.1.2 benchmark in the device ZIP.
        val payload=JSONObject().put("title","Advisory benchmark regression").put("kind","benchmark").put("benchmarkMax",2).put("format","pauper").put("deck",Examples.burn).put("games",1).put("clockSeconds",120).put("seed",24681357).put("bestOf",1).put("players",2).put("engineVersion",BuildConfig.FORGE_VERSION)
            .put("opponents",org.json.JSONArray().put(JSONObject().put("name","Reference burn").put("text",Examples.burn)))
        val id=store.create(payload,"importing")
        try {
            store.update(id,"running","Advisory benchmark regression")
            BenchmarkRunner.run(context,store,store.get(id)!!,monitorSnapshot={PerformanceSettings.resources(context).put("lowMemory",false).put("thermal",3)}) {}
            val restored=store.get(id)!!
            assertEquals(restored.label,"complete",restored.state)
            val report=restored.payload.getJSONObject("benchmarkReport")
            assertEquals(2,report.getInt("maxStable"));assertEquals(6,report.getInt("completedGames"))
            assertEquals(6,store.successfulIndices(id).size)
            val parallel=report.getJSONArray("samples").getJSONObject(1)
            assertTrue(parallel.getBoolean("stable"));assertEquals(2,parallel.getInt("peakSimultaneousGames"))
            assertEquals(3,parallel.getInt("peakThermalStatus"));assertTrue(parallel.getBoolean("thermalThrottlingObserved"))
        } finally {ForgeClient.cancel(id);store.delete(id);store.close()}
    }

}
