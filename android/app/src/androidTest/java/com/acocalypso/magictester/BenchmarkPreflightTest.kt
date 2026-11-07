package com.acocalypso.magictester

import android.app.Application
import androidx.lifecycle.ViewModelStore
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BenchmarkPreflightTest {
    @Test fun mismatchedOwnDeckAndOpponentNeverCreateBenchmarkJobs() = runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val models=ViewModelStore()
        val model=withContext(Dispatchers.Main) {Workbench(context.applicationContext as Application).also {models.put("test",it)}}
        try {
            val before=withContext(Dispatchers.IO) {model.store.all().map {it.id}}
            suspend fun attempt(own: String,opponent: String) {
                withContext(Dispatchers.Main) {
                    model.title="Pauper draft";model.deck=own;model.format="commander"
                    model.opponents=listOf(JSONObject().put("name","Selected opponent").put("text",opponent))
                    model.selected=setOf("Selected opponent")
                    model.benchmark(true,2)
                }
                withTimeout(10000) {while(withContext(Dispatchers.Main) {model.busy}) delay(50)}
                assertTrue(model.message,model.message.contains("No performance test was queued"))
                assertEquals(before,withContext(Dispatchers.IO) {model.store.all().map {it.id}})
            }
            attempt(Examples.burn+"\nSideboard\n4 Pyroblast",Examples.commander())
            assertTrue(model.message,model.message.contains("Your deck ‘Pauper draft’"))
            attempt(Examples.commander(),Examples.burn)
            assertTrue(model.message,model.message.contains("Opponent ‘Selected opponent’"))
        } finally {withContext(Dispatchers.Main) {models.clear()};model.store.close()}
    }
}
