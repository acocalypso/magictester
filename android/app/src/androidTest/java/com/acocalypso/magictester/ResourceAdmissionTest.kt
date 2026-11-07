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
    @Test fun realBaselineBenchmarkFinishesBothGamesUnderAdvisoryReports() = runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val store=RunStore(context)
        val payload=JSONObject().put("title","Advisory benchmark regression").put("kind","benchmark").put("benchmarkMax",1).put("format","pauper").put("deck",Examples.burn).put("games",20).put("clockSeconds",120).put("seed",24681357).put("bestOf",1).put("players",2).put("engineVersion",BuildConfig.FORGE_VERSION)
            .put("opponents",org.json.JSONArray().put(JSONObject().put("name","Reference burn").put("text",Examples.burn)))
        val id=store.create(payload)
        try {
            assertTrue(store.claim(id))
            BenchmarkRunner.run(context,store,store.get(id)!!,resourceSnapshot={PerformanceSettings.resources(context).put("lowMemory",true).put("thermal",3)}) {}
            val restored=store.get(id)!!
            assertEquals(restored.label,"complete",restored.state)
            val report=restored.payload.getJSONObject("benchmarkReport")
            assertEquals(1,report.getInt("maxStable"));assertEquals(2,report.getInt("completedGames"))
            assertEquals(2,store.successfulIndices(id).size)
            assertTrue(report.getJSONArray("samples").getJSONObject(0).getBoolean("stable"))
        } finally {ForgeClient.cancel(id);store.delete(id);store.close()}
    }

}
