package com.acocalypso.magictester

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.json.JSONObject
import org.json.JSONArray
import kotlinx.coroutines.runBlocking

@RunWith(AndroidJUnit4::class)
class ForgeRuntimeTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun command(request: JSONObject): String = runBlocking { ForgeClient.execute(context,request,"acceptance") { _,_ -> }.readText() }
    private fun game(format: String, decks: List<String>, seed: Int = 12345, bestOf: Int = 1): List<JSONObject> {
        val request = JSONObject().put("rawDecks",JSONArray(decks)).put("format",format).put("games",1).put("seed",seed)
            .put("clockSeconds",120).put("mode",if(format == "duel") "duel" else if(DeckText.commander(format)) "commander" else "constructed")
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
    }
    @Test fun nativeBestOfThreeKeepsMatchAndGameEvidence() {
        val events=game("pauper",listOf(Examples.burn+"\nSideboard\n4 Pyroblast\n",Examples.burn+"\nSideboard\n4 Blue Elemental Blast\n"),31337,3)
        val result=events.first { it.optString("type") == "result" }.getJSONObject("result")
        assertEquals(result.toString(),"normal",result.getString("termination"))
        assertEquals("match",result.getString("unit"))
        assertTrue(result.getJSONArray("games").length() in 2..5)
        assertTrue(result.getJSONArray("games").getJSONObject(1).has("sideboardChanges"))
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
