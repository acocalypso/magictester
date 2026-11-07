package com.acocalypso.magictester
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import java.io.File
class RunDeletionTest {
    @Test fun deletingARunRemovesItsEvidenceAndLateResultsCannotRecreateIt() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val store=RunStore(context)
        val id=store.create(JSONObject().put("title","Deletion fixture"))
        try {
            store.update(id,"running","Fixture")
            val input=File(context.cacheDir,"delete-result.jsonl").apply { writeText("{}\n") }
            val evidence=store.saveAttempt(id,input,0)!!
            assertTrue(evidence.exists())
            store.update(id,"deleting","Removing")
            assertTrue(store.delete(id))
            assertNull(store.get(id));assertFalse(evidence.exists())
            assertNull(store.saveAttempt(id,input,1))
            assertFalse(store.file(id,"late.jsonl").parentFile!!.exists())
            assertFalse(store.delete(id))
        } finally {store.close()}
    }
}
