package com.acocalypso.magictester

import android.content.Context
import android.content.ContextWrapper
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

class AnalysisContinuationTest {
    private suspend fun isolated(block: suspend (Context,RunStore)->Unit) {
        val base=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=File(base.cacheDir,"continuation-${UUID.randomUUID()}").apply {mkdirs()}
        val context=object: ContextWrapper(base) {
            override fun getFilesDir()=folder
            override fun getDatabasePath(name: String)=File(folder,name)
            override fun openOrCreateDatabase(name: String,mode: Int,factory: SQLiteDatabase.CursorFactory?)=SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name),factory)
            override fun openOrCreateDatabase(name: String,mode: Int,factory: SQLiteDatabase.CursorFactory?,handler: DatabaseErrorHandler?)=SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name).path,factory,handler)
        }
        val store=RunStore(context)
        try {block(context,store)} finally {store.close();folder.deleteRecursively()}
    }
    private fun payload(games: Int=6)=JSONObject().put("title","Timeout continuation fixture").put("format","pauper").put("deck",Examples.burn)
        .put("games",games).put("clockSeconds",120).put("seed",12345).put("players",2).put("bestOf",3).put("engineVersion",BuildConfig.FORGE_VERSION)
        .put("opponents",JSONArray().put(JSONObject().put("name","Saved opponent").put("text",Examples.burn)))
    private fun evidence(context: Context,index: Int,termination: String="normal",clock: Int=120): File {
        val result=JSONObject().put("engine","forge").put("index",index).put("unit","match").put("clockSeconds",clock).put("termination",termination)
            .put("winner",if(termination=="normal")0 else JSONObject.NULL)
            .put("games",JSONArray().put(JSONObject().put("termination",if(termination=="timeout") "normal" else termination)).put(JSONObject().put("termination",termination)))
        return File(context.filesDir,"attempt-${UUID.randomUUID()}.jsonl").apply {writeText(JSONObject().put("type","result").put("result",result).toString()+"\n")}
    }
    @Test fun timeoutAtMatch45DoesNotAbandonTheLastFiveMatches()=runBlocking {isolated {context,store->
        val id=store.create(payload(50));assertTrue(store.claim(id));val calls=mutableListOf<Int>()
        AnalysisRunner.run(store,store.get(id)!!,{1},{unit->calls+=unit;evidence(context,unit,if(unit==44) "timeout" else "normal")})
        assertEquals((0 until 50).toList(),calls)
        val run=store.get(id)!!;assertEquals("incomplete",run.state);assertEquals(49,run.completed)
        assertEquals(50,store.results(id).size);assertFalse(44 in store.successfulIndices(id));assertTrue(49 in store.successfulIndices(id))
        assertTrue(run.label.contains("1 unfinished"));assertNull(store.next())
        // An incomplete analysis does not block the next queued analysis.
        val next=store.create(payload(1));assertEquals(next,store.next()!!.id);assertTrue(store.claim(next))
        AnalysisRunner.run(store,store.get(next)!!,{1},{evidence(context,it)})
        assertEquals("complete",store.get(next)!!.state)
    }}
    @Test fun parallelTimeoutsAreNotRetriedForeverAndRetrySkipsFinishedMatches()=runBlocking {isolated {context,store->
        val id=store.create(payload());assertTrue(store.claim(id));val calls=mutableListOf<Int>()
        AnalysisRunner.run(store,store.get(id)!!,{2},{unit->delay((unit%2)*10L);calls+=unit;evidence(context,unit,if(unit in listOf(1,4)) "timeout" else "normal")})
        assertEquals((0 until 6).toSet(),calls.toSet());assertEquals(6,calls.size)
        assertEquals("incomplete",store.get(id)!!.state);assertEquals(4,store.get(id)!!.completed)
        val copy=store.importExport(store.export(id));assertEquals("incomplete",store.get(copy)!!.state);assertEquals(4,store.get(copy)!!.completed)
        store.resume(id,180);assertTrue(store.claim(id));calls.clear()
        AnalysisRunner.run(store,store.get(id)!!,{2},{unit->calls+=unit;assertEquals(180,SimulationRequest.unit(store.get(id)!!.payload,unit).getInt("clockSeconds"));evidence(context,unit,clock=180)})
        assertEquals(setOf(1,4),calls.toSet());assertEquals(2,calls.size)
        assertEquals("complete",store.get(id)!!.state);assertEquals(6,store.get(id)!!.completed);assertEquals(8,store.results(id).size)
        val counts=MatchupCharts.totals(store.get(id)!!.payload,store.results(id));assertEquals(6,counts.finished);assertEquals(2,counts.failedAttempts)
    }}
    @Test fun allTimeoutsStillTryEachScheduledMatchExactlyOnce()=runBlocking {isolated {context,store->
        val id=store.create(payload(3));store.claim(id);val calls=mutableListOf<Int>()
        AnalysisRunner.run(store,store.get(id)!!,{1},{unit->calls+=unit;evidence(context,unit,"timeout")})
        assertEquals(listOf(0,1,2),calls);assertEquals(0,store.get(id)!!.completed)
        assertEquals("incomplete",store.get(id)!!.state);assertEquals(3,store.results(id).size)
        assertNull(MatchupCharts.totals(store.get(id)!!.payload,store.results(id)).rate)
    }}
    @Test fun cancellationDoesNotStartRemainingMatchesOrMarkTheRunComplete()=runBlocking {isolated {context,store->
        val id=store.create(payload());store.claim(id);val calls=mutableListOf<Int>();var transient: File?=null
        AnalysisRunner.run(store,store.get(id)!!,{1},{unit->calls+=unit;store.update(id,"cancelled","Cancelled by user");evidence(context,unit).also {transient=it}})
        assertEquals(listOf(0),calls);assertEquals("cancelled",store.get(id)!!.state);assertTrue(store.results(id).isEmpty());assertFalse(transient!!.exists())
    }}
    @Test fun engineFailureStillStopsAndRetainsItsEvidence()=runBlocking {isolated {context,store->
        val id=store.create(payload());store.claim(id);val calls=mutableListOf<Int>()
        try {
            AnalysisRunner.run(store,store.get(id)!!,{1},{unit->calls+=unit;evidence(context,unit,"engine_error")})
            fail("Engine failures require review rather than being mistaken for timeouts")
        } catch(error:IllegalStateException) {assertTrue(error.message!!.contains("engine error"))}
        assertEquals(listOf(0),calls);assertEquals("engine_error",store.results(id).single().getString("termination"));assertEquals(0,store.get(id)!!.completed)
    }}
}
