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
}
