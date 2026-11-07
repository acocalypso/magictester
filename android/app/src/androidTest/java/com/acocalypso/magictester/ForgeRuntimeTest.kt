package com.acocalypso.magictester

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import org.magictester.engine.AndroidForgeBridge

@RunWith(AndroidJUnit4::class)
class ForgeRuntimeTest {
    @Test fun realGameOnAndroidRuntime() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val home = EngineAssets.install(context) { _, _ -> }
        AndroidForgeBridge.initialize(home.absolutePath) { }
        val deck = File(context.cacheDir, "android-burn.dck")
        deck.writeText("[metadata]\nName=Android Burn\n[Main]\n20 Mountain\n4 Lightning Bolt\n4 Lava Spike\n4 Rift Bolt\n4 Chain Lightning\n4 Lightning Strike\n4 Shock\n4 Searing Spear\n4 Kessig Flamebreather\n4 Thermo-Alchemist\n[Sideboard]\n".replace("\n", "
"))
        val events = mutableListOf<JSONObject>()
        AndroidForgeBridge.execute(JSONObject().put("decks", JSONArray(listOf(deck.absolutePath, deck.absolutePath))).put("games",1).put("seed",12345).put("clockSeconds",120).put("mode","constructed").toString()) { events += JSONObject(it) }
        val failure = events.firstOrNull { it.optString("type") == "error" }
        assertNull(failure?.toString(), failure)
        val result = events.first { it.optString("type") == "result" }.getJSONObject("result")
        assertEquals(result.toString(), "normal", result.getString("termination"))
        assertTrue(result.getJSONObject("actionLog").getJSONArray("entries").length() > 20)
        assertTrue(events.any { it.optString("type") == "batch_complete" })
    }
}
