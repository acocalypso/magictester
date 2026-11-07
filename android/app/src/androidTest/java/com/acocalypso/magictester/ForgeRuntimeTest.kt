package com.acocalypso.magictester

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Rule
import androidx.test.ext.junit.rules.ActivityScenarioRule
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.json.JSONObject
import org.json.JSONArray
import kotlinx.coroutines.runBlocking

@RunWith(AndroidJUnit4::class)
class ForgeRuntimeTest {
    @get:Rule val visibleWorkbench=ActivityScenarioRule(MainActivity::class.java)
    private val timingEvents=mutableListOf<JSONObject>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun command(request: JSONObject): String = runBlocking { ForgeClient.execute(context,request,"acceptance",onGame={timingEvents += it}) { _,_ -> }.readText() }
    private fun game(format: String, decks: List<String>, seed: Int = 12345, bestOf: Int = 1): List<JSONObject> {
        val request = JSONObject().put("rawDecks",JSONArray(decks)).put("format",format).put("games",1).put("seed",seed)
            .put("clockSeconds",if(DeckText.commander(format)) 300 else 120).put("mode",if(format == "duel") "duel" else if(DeckText.commander(format)) "commander" else "constructed")
            .put("bestOf",bestOf).put("sideboarding",bestOf==3).put("maxMatchGames",5)
        return command(request).lineSequence().filter { it.isNotBlank() }.map { JSONObject(it) }.toList()
    }
    @Test fun realGameOnAndroidRuntimeWithStructuredActions() {
        val events=game("pauper",listOf(Examples.burn,Examples.burn))
        assertNull(events.firstOrNull { it.optString("type") == "error" }?.toString())
        val result=events.first { it.optString("type") == "result" }.getJSONObject("result")
        assertEquals(result.toString(),"normal",result.getString("termination"))
        assertTrue(result.getJSONObject("actionLog").getJSONArray("entries").length() > 20)
        assertTrue(events.any { it.optString("type") == "batch_complete" })
        assertEquals(listOf("game_started","game_finished"),timingEvents.map { it.getString("type") })
        assertTrue(timingEvents.first().getLong("startedElapsedMs")>0)
        assertEquals(result.getLong("durationMs"),timingEvents.last().getLong("durationMs"))
    }
    @Test fun engineFailureRetainsFullJavaErrorForDiagnosticExport() {
        val runId="diagnostic-engine-acceptance"
        try {
            runBlocking { ForgeClient.execute(context,JSONObject().put("rawDecks",JSONArray(listOf("Deck\n60 No Such MagicTester Card",Examples.burn))).put("format","pauper").put("games",1).put("seed",1).put("clockSeconds",5).put("mode","constructed"),runId) { _,_ -> } }
            fail("Unsupported cards must fail")
        } catch(error:IllegalStateException) { assertTrue(error.message.orEmpty(),error.message.orEmpty().contains("supported card script")) }
        val bytes=java.io.ByteArrayOutputStream()
        DiagnosticExporter.write(context,bytes,runId)
        val files=java.util.zip.ZipInputStream(bytes.toByteArray().inputStream()).use { zip -> buildMap<String,String> {
            while(true) { val entry=zip.nextEntry ?: break;put(entry.name,zip.bufferedReader().readText());zip.closeEntry() }
        } }
        assertTrue(files.getValue("errors.txt"),files.getValue("errors.txt").contains("EngineService"))
        assertTrue(files.values.any { it.contains("No Such MagicTester Card") })
        assertTrue(files.keys.any { it.endsWith("stderr.log") })
    }
    @Test fun nativeBestOfThreeKeepsMatchAndGameEvidence() {
        val events=game("pauper",listOf(Examples.burn+"\nSideboard\n4 Pyroblast\n",Examples.burn+"\nSideboard\n4 Blue Elemental Blast\n"),31337,3)
        val result=events.first { it.optString("type") == "result" }.getJSONObject("result")
        assertEquals(result.toString(),"normal",result.getString("termination"))
        assertEquals("match",result.getString("unit"))
        assertTrue(result.getJSONArray("games").length() in 2..5)
        assertTrue(result.getJSONArray("games").getJSONObject(1).has("sideboardChanges"))
        val starts=timingEvents.filter { it.getString("type")=="game_started" }
        assertEquals(result.getJSONArray("games").length(),starts.size)
        assertEquals((0 until starts.size).toList(),starts.map { it.getInt("gameIndex") })
        assertTrue(starts.zipWithNext().all { (a,b) -> b.getLong("startedElapsedMs")>a.getLong("startedElapsedMs") })
    }
    @Test fun legalCommanderPairHasCombinedIdentityWithoutErrorFlood() {
        val text="// Commanders\n1 Ravos, Soultender\n1 Tymna the Weaver\nDeck\n97 Plains\n1 Swamp\n"
        val result=JSONObject(command(JSONObject().put("operation","validate").put("text",text).put("format","commander")))
        assertTrue(result.toString(),result.getBoolean("valid"))
        val wrong=JSONObject(command(JSONObject().put("operation","validate").put("text",text.replace("1 Swamp","1 Mountain")).put("format","commander")))
        assertFalse(wrong.toString(),wrong.getBoolean("valid"))
        assertTrue(wrong.getJSONArray("errors").length() <= 3)
    }
    @Test fun multiplayerCommanderAndDuelUseNativeLifeAndPlacements() {
        val decks=listOf(Examples.commander(),Examples.commander("Ambassador Laquatus"))
        for(format in listOf("commander","duel")) {
            val participants=if(format=="commander") decks+decks else decks
            val events=game(format,participants,424242)
            val result=events.first { it.optString("type") == "result" }.getJSONObject("result")
            assertEquals(result.toString(),"normal",result.getString("termination"))
            val life=result.getJSONArray("startingLife")
            assertEquals(participants.size,life.length())
            for(i in 0 until life.length()) assertEquals(if(format=="duel") 20 else 40,life.getInt(i))
            assertEquals(participants.size,result.getJSONArray("players").length())
            assertTrue(result.getJSONArray("commanderCasts").length() > 0)
        }
    }
    @Test fun standardColorIdentityRejectsColoredBasicsWithAColorlessCommander() {
        val result=JSONObject(command(JSONObject().put("operation","validate").put("text","Commander\n1 Kozilek, the Great Distortion\nDeck\n99 Plains\n").put("format","commander")))
        assertFalse(result.toString(),result.getBoolean("valid"))
        assertTrue(result.toString(),result.getJSONArray("errors").toString().contains("color identity"))
    }
    @Test fun duelStructuralCheckDoesNotApplyMultiplayerCommanderBans() {
        val result=JSONObject(command(JSONObject().put("operation","validate").put("text","Commander\n1 Golos, Tireless Pilgrim\nDeck\n99 Plains\n").put("format","duel")))
        assertTrue(result.toString(),result.getBoolean("valid"))
    }
    @Test fun companionRestrictionRejectsInvalidStartingDeck() {
        val result=JSONObject(command(JSONObject().put("operation","validate").put("text",Examples.burn.replace("4 Thermo-Alchemist","4 Goblin Chieftain")+"\nCompanion\n1 Lurrus of the Dream-Den\n").put("format","legacy")))
        assertFalse(result.toString(),result.getBoolean("valid"))
        assertTrue(result.toString(),result.getJSONArray("errors").toString().contains("companion requirement"))
    }
    @Test fun cancellationStopsEngineWithoutStoppingTheApplication() = runBlocking {
        var killed=false
        try {
            ForgeClient.execute(context,JSONObject().put("operation","setup"),"cancel-acceptance") { _,_ ->
                if(!killed) { killed=true;ForgeClient.cancel("cancel-acceptance") }
            }
            fail("Cancelled engine must not report setup success")
        } catch(_:IllegalStateException) { }
        assertTrue(killed)
        val result=JSONObject(command(JSONObject().put("operation","setup")))
        assertTrue(result.getBoolean("ready"))
    }
}
