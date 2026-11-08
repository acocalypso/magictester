package com.acocalypso.magictester

import android.content.Context
import android.content.ContextWrapper
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

class ProcessRecoveryTest {
    private fun isolated(): Context {
        val base=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=File(base.cacheDir,"recovery-${UUID.randomUUID()}").apply {mkdirs()}
        return object: ContextWrapper(base) {
            override fun getFilesDir()=folder
            override fun getDatabasePath(name: String)=File(folder,name)
            override fun openOrCreateDatabase(name: String,mode: Int,factory: SQLiteDatabase.CursorFactory?)=SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name),factory)
            override fun openOrCreateDatabase(name: String,mode: Int,factory: SQLiteDatabase.CursorFactory?,handler: DatabaseErrorHandler?)=SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name).path,factory,handler)
        }
    }
    @Test fun processRecreationPreservesEvidenceAndBaselineOrderWithoutInfiniteRetries() {
        val context=isolated()
        var store=RunStore(context)
        try {
            val baseline=store.create(JSONObject().put("title","Baseline").put("format","pauper"))
            val candidate=store.create(JSONObject().put("title","Candidate"))
            assertTrue(store.claim(baseline))
            val receipt=File(context.cacheDir,"receipt-${UUID.randomUUID()}.jsonl")
            receipt.writeText(JSONObject().put("type","result").put("result",JSONObject().put("index",0).put("termination","normal").put("winner",0)).toString()+"\n")
            val saved=store.saveAttempt(baseline,receipt,0)!!;receipt.delete()
            store.update(baseline,"running","Saved first match",1)
            val bytes=saved.readText()
            store.close();store=RunStore(context)
            store.recover()
            assertEquals(baseline,store.next()!!.id)
            assertEquals(1,store.get(baseline)!!.completed)
            assertEquals(setOf(0),store.successfulIndices(baseline))
            assertEquals(bytes,saved.readText())
            assertEquals(1,store.get(baseline)!!.payload.getInt("processRecoveryAttempts"))
            store.recover() // Opening another window must not consume a retry.
            assertEquals(1,store.get(baseline)!!.payload.getInt("processRecoveryAttempts"))
            repeat(2) {assertTrue(store.claim(baseline));store.recover()}
            assertEquals("interrupted",store.get(baseline)!!.state)
            assertEquals(candidate,store.next()!!.id)
            store.resume(baseline,120)
            assertFalse(store.get(baseline)!!.payload.has("processRecoveryAttempts"))
            assertEquals(setOf(0),store.successfulIndices(baseline))
        } finally {store.close();context.filesDir.deleteRecursively()}
    }
    @Test fun recoveryDoesNotRestartCancelledCompletedFailedOrBenchmarkWork() {
        val context=isolated();val store=RunStore(context)
        try {
            val states=listOf("cancelled","complete","failed","interrupted")
            val ids=states.map {state->store.create(JSONObject()).also {store.update(it,state,state)}}
            val benchmark=store.create(JSONObject().put("kind","benchmark"));assertTrue(store.claim(benchmark))
            store.recover()
            states.zip(ids).forEach {(state,id)->assertEquals(state,store.get(id)!!.state)}
            assertEquals("interrupted",store.get(benchmark)!!.state)
            assertNull(store.next())
        } finally {store.close();context.filesDir.deleteRecursively()}
    }
}
