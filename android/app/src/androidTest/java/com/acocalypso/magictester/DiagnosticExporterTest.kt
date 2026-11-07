package com.acocalypso.magictester

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Test
import org.junit.Assert.*
import java.io.ByteArrayOutputStream
import java.util.zip.ZipInputStream

class DiagnosticExporterTest {
    private fun archive(runId: String, decks: Boolean): Map<String,String> {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val bytes=ByteArrayOutputStream()
        DiagnosticExporter.write(context,bytes,runId,decks)
        return ZipInputStream(bytes.toByteArray().inputStream()).use { zip -> buildMap {
            while(true) { val entry=zip.nextEntry ?: break;put(entry.name,zip.bufferedReader().readText());zip.closeEntry() }
        } }
    }
    @Test fun failedRunExportPreservesErrorsAndKeepsCompleteDecklistsOptional() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val store=RunStore(context)
        val privateCard="PRIVATE_DECK_MARKER_42"
        val runId=store.create(JSONObject().put("title","Diagnostic fixture").put("deck","1 $privateCard").put("format","commander").put("games",1).put("clockSeconds",300).put("seed",73).put("engineVersion",BuildConfig.FORGE_VERSION).put("opponents",JSONArray().put(JSONObject().put("name","Fixture opponent").put("text","1 PRIVATE_OPPONENT_MARKER"))))
        store.update(runId,"failed","Fixture engine failure")
        Diagnostics.event("run.exception","Fixture engine failure",runId,level="ERROR",error=IllegalStateException("Fixture Java error"))
        Diagnostics.captureCrash(context,Thread.currentThread(),IllegalStateException("Synthetic diagnostic test crash"))
        val console=Diagnostics.captureConsole(context,runId)
        try { System.err.println("Fixture engine stderr preserved") } finally { console.restore() }
        val safe=archive(runId,false)
        assertTrue(safe.getValue("summary.txt").contains("Fixture engine failure"))
        assertTrue(safe.getValue("errors.txt").contains("Fixture Java error"))
        assertTrue(safe.values.any { it.contains("Fixture engine stderr preserved") })
        assertTrue(safe.keys.any { it.contains("crash-") })
        assertTrue(safe.containsKey("device.json"));assertTrue(safe.containsKey("process-exits.txt"))
        assertFalse(safe.values.any { it.contains(privateCard) || it.contains("PRIVATE_OPPONENT_MARKER") })
        assertFalse(safe.keys.any { it.endsWith("decklists.txt") })
        val full=archive(runId,true)
        assertTrue(full.getValue("runs/$runId/decklists.txt").contains(privateCard))
        assertTrue(full.getValue("runs/$runId/decklists.txt").contains("PRIVATE_OPPONENT_MARKER"))
        store.close()
    }
}
