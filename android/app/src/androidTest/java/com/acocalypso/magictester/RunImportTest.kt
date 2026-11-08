package com.acocalypso.magictester

import android.content.Context
import android.content.ContextWrapper
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Test
import org.junit.Assert.*
import java.io.File
import java.util.UUID

class RunImportTest {
    private fun isolated(): Context {
        val base=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=File(base.cacheDir,"import-${UUID.randomUUID()}").apply {mkdirs()}
        return object: ContextWrapper(base) {
            override fun getFilesDir()=folder
            override fun getDatabasePath(name: String)=File(folder,name)
            override fun openOrCreateDatabase(name: String,mode: Int,factory: SQLiteDatabase.CursorFactory?)=SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name),factory)
            override fun openOrCreateDatabase(name: String,mode: Int,factory: SQLiteDatabase.CursorFactory?,handler: DatabaseErrorHandler?)=SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name).path,factory,handler)
        }
    }
    @Test fun importingAnActiveExportCreatesAnInterruptedCopyWithoutQueuingWork() {
        val store=RunStore(isolated())
        try {
            val payload=JSONObject().put("title","Old installation").put("format","pauper").put("deck",Examples.burn).put("games",1).put("clockSeconds",120).put("seed",12345).put("engineVersion",BuildConfig.FORGE_VERSION).put("opponents",JSONArray().put(JSONObject().put("name","Saved opponent").put("text",Examples.burn)))
            val archive=JSONObject().put("schemaVersion",1).put("application","MagicTester Android").put("runId","old-run").put("state","running").put("settings",payload).put("results",JSONArray())
            val first=store.importExport(archive.toString());val second=store.importExport(archive.toString())
            assertNotEquals(first,second);assertEquals("interrupted",store.get(first)!!.state)
            assertEquals("old-run",store.get(first)!!.payload.getString("importedFromRunId"))
            assertEquals(payload.getJSONArray("opponents").toString(),store.get(first)!!.payload.getJSONArray("opponents").toString())
            assertNull(store.next());assertEquals(2,store.all().size)
        } finally {store.close()}
    }
    @Test fun longCommanderTimeoutSurvivesImportAndRetryWithFormatBoundaries() {
        val store=RunStore(isolated())
        try {
            val payload=JSONObject().put("title","Long Commander game").put("format","commander").put("deck",Examples.commander()).put("games",1).put("clockSeconds",1800).put("seed",12345).put("engineVersion",BuildConfig.FORGE_VERSION).put("opponents",JSONArray().put(JSONObject().put("name","Opponent").put("text",Examples.commander())))
            val archive=JSONObject().put("schemaVersion",1).put("application","MagicTester Android").put("state","interrupted").put("settings",payload).put("results",JSONArray())
            val id=store.importExport(archive.toString())
            assertEquals(1800,store.get(id)!!.payload.getInt("clockSeconds"))
            store.resume(id,1800)
            assertEquals("queued",store.get(id)!!.state)
            assertEquals(1800,SimulationRequest.unit(store.get(id)!!.payload,0).getInt("clockSeconds"))
            store.update(id,"interrupted","Test retry")
            try {store.resume(id,1801);fail("Above-ceiling retry must fail")} catch(_:IllegalArgumentException) {}
            assertEquals("interrupted",store.get(id)!!.state)
            payload.put("format","pauper")
            try {store.importExport(archive.toString());fail("Constructed clock must keep its limit")} catch(_:IllegalArgumentException) {}
            assertEquals(1,store.all().size)
        } finally {store.close()}
    }
    @Test fun selectedPolicySurvivesExportImportAndRetryAndUnknownPolicyIsRejected() {
        val store=RunStore(isolated())
        try {
            val settings=JSONObject().put("title","Experimental policy fixture").put("format","pauper").put("deck",Examples.burn)
                .put("games",1).put("clockSeconds",120).put("seed",12345).put("engineVersion",BuildConfig.FORGE_VERSION)
                .put("aiPolicy",AiPolicy.TACTICAL).put("opponents",JSONArray().put(JSONObject().put("name","Opponent").put("text",Examples.burn)))
            val archive=JSONObject().put("schemaVersion",1).put("application","MagicTester Android").put("state","interrupted").put("settings",settings).put("results",JSONArray())
            val original=store.importExport(archive.toString())
            val copy=store.importExport(store.export(original))
            store.resume(copy,180)
            val policies=SimulationRequest.unit(store.get(copy)!!.payload,0).getJSONArray("aiPolicies")
            assertEquals(AiPolicy.TACTICAL,policies.getString(0));assertEquals(AiPolicy.TACTICAL,policies.getString(1))
            settings.put("aiPolicy","unknown-policy")
            try {store.importExport(archive.toString());fail("Unknown policy imported")} catch(_:IllegalArgumentException) {}
            assertEquals(2,store.all().size)
        } finally {store.close()}
    }
    @Test fun unrelatedOrMalformedJsonDoesNotCreateAnAnalysis() {
        val store=RunStore(isolated())
        try {
            for(text in listOf("{}","{broken",JSONObject().put("schemaVersion",1).put("application","MagicTester Android").put("settings",JSONObject()).toString())) {
                try {store.importExport(text);fail("Invalid exports must be rejected")} catch(_:Exception) {}
            }
            assertTrue(store.all().isEmpty());assertNull(store.next())
        } finally {store.close()}
    }
}
