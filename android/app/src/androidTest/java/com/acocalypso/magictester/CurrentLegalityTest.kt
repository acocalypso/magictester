package com.acocalypso.magictester
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import java.io.File
import java.util.UUID

class CurrentLegalityTest {
    private fun source(): CurrentLegality {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        return CurrentLegality(context,{ body ->
            val names=JSONObject(body).getJSONArray("identifiers")
            val cards=JSONArray()
            for(i in 0 until names.length()) {
                val name=names.getJSONObject(i).getString("name")
                cards.put(JSONObject().put("name",name).put("legalities",JSONObject().put("duel",if(name=="Rofellos, Llanowar Emissary") "restricted" else "legal")))
            }
            JSONObject().put("data",cards).put("not_found",JSONArray()).toString()
        },File(context.cacheDir,"legality-test-${UUID.randomUUID()}"))
    }
    @Test fun duelRestrictedMeansBannedAsCommanderInsteadOfBannedInLibrary() {
        source().check(listOf("Commander\n1 Ezuri, Renegade Leader\nDeck\n1 Rofellos, Llanowar Emissary\n98 Forest"),"duel")
        try {
            source().check(listOf("Commander\n1 Rofellos, Llanowar Emissary\nDeck\n99 Forest"),"duel")
            fail("A commander-role ban must be rejected")
        } catch(error:IllegalArgumentException) { assertTrue(error.message.orEmpty().contains("banned as a commander")) }
    }
    @Test fun combinedPathwayUsesFrontFaceAndCachesTheWholeCardForBothAliases() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val directory=File(context.cacheDir,"pathway-${UUID.randomUUID()}")
        var calls=0
        val source=CurrentLegality(context,{body ->
            calls++
            val identifiers=JSONObject(body).getJSONArray("identifiers")
            assertEquals(1,identifiers.length())
            assertEquals("Brightclimb Pathway",identifiers.getJSONObject(0).getString("name"))
            JSONObject().put("not_found",JSONArray()).put("data",JSONArray().put(JSONObject().put("name","Brightclimb Pathway // Grimclimb Pathway").put("color_identity",JSONArray(listOf("W","B"))).put("legalities",JSONObject().put("commander","legal").put("pauper","not_legal")))).toString()
        },directory)
        try {
            val text="Deck\n1 Brightclimb Pathway // Grimclimb Pathway\n1 Brightclimb Pathway"
            source.check(listOf(text),"commander")
            source.check(listOf(text),"commander")
            assertEquals(1,calls)
            val cached=JSONObject(File(directory,Http.sha("brightclimb pathway // grimclimb pathway")+".json").readText())
            assertEquals("Brightclimb Pathway // Grimclimb Pathway",cached.getString("name"))
            assertEquals(2,cached.getJSONArray("color_identity").length())
            try {source.check(listOf(text),"pauper");fail("The complete card's format legality must still be enforced")}
            catch(error:IllegalArgumentException) {assertTrue(error.message.orEmpty().contains("not legal in pauper"))}
            assertEquals(1,calls)
            try {source.check(listOf("Deck\n1 Brightclimb Pathway // Mountain"),"commander");fail("A mismatched back-face name must not be silently ignored")}
            catch(error:IllegalArgumentException) {assertTrue(error.message.orEmpty().contains("both faces must match"))}
        } finally {directory.deleteRecursively()}
    }

}
