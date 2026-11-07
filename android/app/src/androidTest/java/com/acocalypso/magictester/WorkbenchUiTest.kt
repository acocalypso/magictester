package com.acocalypso.magictester
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import java.io.File
class WorkbenchUiTest {
    companion object {
        @JvmStatic @org.junit.BeforeClass fun grantNotifications() {
            if(android.os.Build.VERSION.SDK_INT >= 33) InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("pm grant com.acocalypso.magictester android.permission.POST_NOTIFICATIONS").close()
        }
    }
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private fun phoneBack() {
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        val now=android.os.SystemClock.uptimeMillis()
        for(action in listOf(android.view.KeyEvent.ACTION_DOWN,android.view.KeyEvent.ACTION_UP)) {
            val event=android.view.KeyEvent(now,android.os.SystemClock.uptimeMillis(),action,android.view.KeyEvent.KEYCODE_BACK,0,0,android.view.KeyCharacterMap.VIRTUAL_KEYBOARD,0,0,android.view.InputDevice.SOURCE_KEYBOARD)
            org.junit.Assert.assertTrue("System Back key injection failed",automation.injectInputEvent(event,true))
        }
        compose.waitForIdle()
    }
    @Test fun firstRunAndNavigationAreReadable() {
        compose.onNodeWithText("MagicTester").assertIsDisplayed()
        compose.onNodeWithText("Setup",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Set up local engine").assertIsDisplayed()
        compose.onNodeWithText("Export diagnostic logs").performScrollTo().performClick()
        compose.onNodeWithText("Include complete decklists").assertIsDisplayed()
        compose.onNodeWithText("Cancel").performClick()
        compose.onNodeWithText("Import exported analyses").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Performance & parallel games").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Run device performance test").assertExists()
        compose.onNodeWithText("Pools",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Opponent pools").assertIsDisplayed()
        compose.onNodeWithText("Test",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Put your deck\nto the test.").assertIsDisplayed()
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val screenshot=instrumentation.uiAutomation.takeScreenshot()
        val destination=File(instrumentation.targetContext.filesDir,"acceptance-ui.png")
        destination.outputStream().use { screenshot.compress(Bitmap.CompressFormat.PNG,100,it) }
    }
    @Test fun phoneBackReturnsFromGameToRunThenListAndPreviousTab() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val store=RunStore(context)
        val payload=org.json.JSONObject().put("title","Back navigation fixture").put("format","pauper").put("deck",Examples.burn).put("games",1).put("clockSeconds",120).put("engineVersion",BuildConfig.FORGE_VERSION)
            .put("opponents",org.json.JSONArray().put(org.json.JSONObject().put("name","Navigation opponent").put("text",Examples.burn)))
        val id=store.create(payload)
        try {
            store.update(id,"running","Navigation fixture")
            val evidence=File(context.cacheDir,"navigation.jsonl").apply {writeText(org.json.JSONObject().put("type","result").put("result",org.json.JSONObject().put("index",0).put("termination","normal").put("winner",0).put("turns",5).put("actionLog",org.json.JSONObject().put("complete",true).put("entries",org.json.JSONArray()))).toString()+"\n")}
            store.saveAttempt(id,evidence,0);store.update(id,"complete","Navigation fixture",1)
            compose.onNodeWithText("Test",useUnmergedTree=true).performClick()
            compose.onNodeWithText("Runs",useUnmergedTree=true).performClick()
            compose.waitUntil(10000) {compose.onAllNodesWithText("Back navigation fixture").fetchSemanticsNodes().isNotEmpty()}
            compose.onNodeWithText("Back navigation fixture").performScrollTo().performClick()
            compose.waitUntil(10000) {runCatching {compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("View observed game →"));true}.getOrDefault(false)}
            compose.onNodeWithText("View observed game →").performClick()
            compose.onNodeWithText("Observed game").assertIsDisplayed()
            phoneBack()
            compose.onNodeWithText("View observed game →").assertIsDisplayed()
            compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("Your decklist"))
            compose.onNodeWithText("Your decklist").performClick()
            compose.onNodeWithText("Close").assertIsDisplayed()
            phoneBack()
            compose.onNodeWithText("Your decklist").assertIsDisplayed()
            phoneBack()
            compose.onNodeWithText("Your analyses").assertExists()
            phoneBack()
            compose.onNodeWithText("Put your deck\nto the test.").assertExists()
        } finally {store.delete(id);store.close()}
    }

}
