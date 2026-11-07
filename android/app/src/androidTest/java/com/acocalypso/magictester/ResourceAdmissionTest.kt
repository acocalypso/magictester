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
}
