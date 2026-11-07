package com.acocalypso.magictester

import android.content.ContextWrapper
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Test
import org.junit.Assert.*
import java.io.File
import java.util.UUID

class MetagamePoolTest {
    @Test fun refreshReplacesSixDeckCacheAndKeepsSearchingUntilTenWholeDecks() {
        val base=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=File(base.cacheDir,"meta-${UUID.randomUUID()}").apply {mkdirs()}
        val context=object: ContextWrapper(base) {override fun getFilesDir()=folder}
        val directory=File(folder,"meta").apply {mkdirs()}
        File(directory,"pauper.json").writeText(JSONObject().put("format","pauper").put("fetchedAt",System.currentTimeMillis()).put("decks",JSONArray((1..6).toList())).toString())
        val visited=mutableListOf<String>()
        val meta=Metagame(context) {url ->
            visited+=url
            val uri=java.net.URI(url)
            when(uri.path) {
                "/format" -> "<table>"+(1..12).joinToString("") {"<tr class='hover_tr'><td><a href='/archetype?a=$it'>Archetype $it</a></td><td>${20.0-it}%</td></tr>"}+"</table>"
                "/archetype" -> if(uri.query in listOf("a=1","a=2")) "<p>No usable deck</p>" else "<a href='/event?d=${uri.query.substringAfter('=')}'>Deck</a>"
                "/event" -> "<div class='S14'>MD 60 SB 0</div><div class='deck_line' id='md1'>60 <span class='L14'>Mountain</span></div>"
                else -> error("Unexpected test page")
            }
        }
        try {
            val pool=meta.refresh("pauper")
            val decks=pool.getJSONArray("decks")
            assertEquals(10,decks.length());assertTrue(pool.getBoolean("complete"))
            assertEquals("Archetype 3",decks.getJSONObject(0).getString("name"))
            assertEquals("Archetype 12",decks.getJSONObject(9).getString("name"))
            assertEquals(10,(0 until decks.length()).map {decks.getJSONObject(it).getString("source")}.distinct().size)
            val calls=visited.size
            assertEquals(10,meta.refresh("pauper").getJSONArray("decks").length())
            assertEquals(calls,visited.size)
        } finally {folder.deleteRecursively()}
    }
}
