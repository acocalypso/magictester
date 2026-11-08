package com.acocalypso.magictester
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import java.io.File
class WorkbenchUiTest {
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
    @Test fun expandedPolicyAndPairedComparisonCanBeSelectedForANewAnalysis() {
        compose.onNodeWithText("Test",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Choose AI policy").performScrollTo().performClick()
        compose.onNodeWithText("Expanded v2 · experimental").performClick()
        compose.onNodeWithText("AI: Expanded v2 · experimental").assertIsDisplayed()
        compose.onNodeWithContentDescription("Also queue a native comparison").performScrollTo().assertIsOff().performClick().assertIsOn()
        compose.onNodeWithText("Queue comparison").performScrollTo().assertExists()
        compose.onNodeWithText("Pools",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Test",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Choose AI policy").performScrollTo()
        compose.onNodeWithText("AI: Expanded v2 · experimental").assertIsDisplayed()
        compose.onNodeWithContentDescription("Also queue a native comparison").performScrollTo().assertIsOn()
        compose.onNodeWithText("Choose AI policy").performScrollTo().performClick()
        compose.onNodeWithText("Native Forge").performClick()
        compose.onNodeWithText("Queue analysis").performScrollTo().assertExists()
    }
    @Test fun linkedComparisonReturnsToThePreviousRunOnPhoneBack() {
        val store=RunStore(InstrumentationRegistry.getInstrumentation().targetContext)
        val source=org.json.JSONObject().put("title","Comparison fixture").put("format","pauper").put("deck",Examples.burn)
            .put("games",1).put("clockSeconds",120).put("seed",55).put("aiPolicy",AiPolicy.EXPANDED).put("engineVersion",BuildConfig.FORGE_VERSION)
            .put("opponents",org.json.JSONArray().put(org.json.JSONObject().put("name","Opponent").put("text",Examples.burn)))
        val pair=AiComparison.prepare(source)
        pair[0].put("title","Linked native fixture");pair[1].put("title","Linked candidate fixture")
        val ids=store.createBatch(pair)
        try {
            for(id in ids) store.update(id,"interrupted","Navigation fixture")
            compose.onNodeWithText("Runs",useUnmergedTree=true).performClick()
            compose.waitUntil(5000) {compose.onAllNodesWithText("Linked candidate fixture").fetchSemanticsNodes().isNotEmpty()}
            compose.onNodeWithText("Linked candidate fixture").performClick()
            compose.onNodeWithText("Open Native Forge").performScrollTo().performClick()
            compose.onNodeWithText("Linked native fixture").assertIsDisplayed()
            phoneBack()
            compose.onNodeWithText("Linked candidate fixture").assertIsDisplayed()
            phoneBack()
            compose.onNodeWithText("Your analyses").assertIsDisplayed()
        } finally {for(id in ids) store.delete(id);store.close()}
    }
    @Test fun firstRunAndNavigationAreReadable() {
        compose.onNodeWithText("MagicTester").assertIsDisplayed()
        compose.onNodeWithText("Setup",useUnmergedTree=true).performClick()
        // Setup is scrollable; a restored scroll offset or a small viewport must
        // not be mistaken for a missing control as more settings are added.
        compose.onNodeWithText("Set up local engine").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Export diagnostic logs").performScrollTo().performClick()
        compose.onNodeWithText("Include complete decklists").assertIsDisplayed()
        compose.onNodeWithText("Cancel").performClick()
        compose.onNodeWithText("Import exported analyses").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Open battery optimization settings").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Open MagicTester app settings").performScrollTo().assertIsDisplayed()
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
            val evidence=File(context.cacheDir,"navigation.jsonl").apply {writeText(org.json.JSONObject().put("type","result").put("result",org.json.JSONObject().put("index",0).put("termination","normal").put("winner",0).put("turns",5).put("actionLog",org.json.JSONObject().put("complete",true).put("entries",org.json.JSONArray().put(org.json.JSONObject().put("kind","STACK_ADD").put("turn",3).put("text","player-1 cast Cast Down targeting player-0's creature."))))).toString()+"\n")}
            store.saveAttempt(id,evidence,0);store.update(id,"complete","Navigation fixture",1)
            compose.onNodeWithText("Test",useUnmergedTree=true).performClick()
            compose.onNodeWithText("Runs",useUnmergedTree=true).performClick()
            compose.waitUntil(10000) {compose.onAllNodesWithText("Back navigation fixture").fetchSemanticsNodes().isNotEmpty()}
            compose.onNodeWithText("Back navigation fixture").performScrollTo().performClick()
            compose.waitUntil(10000) {runCatching {compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("View observed game →"));true}.getOrDefault(false)}
            compose.onNodeWithText("View observed game →").performClick()
            compose.onNodeWithText("Observed game").assertIsDisplayed()
            compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("Opponent 1 cast Cast Down targeting Your creature."))
            compose.onNodeWithText("Opponent 1 cast Cast Down targeting Your creature.").assertIsDisplayed()
            phoneBack()
            compose.waitUntil(10000) {compose.onNodeWithText("View observed game →").isDisplayed()}
            compose.onNodeWithText("View observed game →").assertIsDisplayed()
            compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("Your decklist"))
            compose.onNodeWithText("Your decklist").performClick()
            compose.onNodeWithText("Close").assertIsDisplayed()
            phoneBack()
            compose.waitUntil(10000) {!compose.onNodeWithText("Close").isDisplayed() && compose.onNodeWithText("Your decklist").isDisplayed()}
            compose.onNodeWithText("Your decklist").assertIsDisplayed()
            phoneBack()
            compose.waitUntil(10000) {compose.onAllNodesWithText("Your analyses").fetchSemanticsNodes().isNotEmpty()}
            compose.onNodeWithText("Your analyses").assertExists()
            phoneBack()
            compose.waitUntil(10000) {compose.onAllNodesWithText("Put your deck\nto the test.").fetchSemanticsNodes().isNotEmpty()}
            compose.onNodeWithText("Put your deck\nto the test.").assertExists()
        } catch(error:Throwable) {
            runCatching {compose.onRoot().printToLog("MagicTesterBackFailure")}
            runCatching {File(context.filesDir,"acceptance-back-failure.png").outputStream().use {InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG,100,it)}}
            throw error
        } finally {store.delete(id);store.close()}
    }

    @Test fun savedDeckLoadsUpdatesAndProtectsUnsavedChanges() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val library=DeckLibrary(context)
        val text="Commander\n1 Ravos, Soultender\n1 Tymna the Weaver\nDeck\n98 Plains\n"
        val saved=library.save(null,"UI library fixture","commander",text,"https://moxfield.com/decks/gJFmgkq120Srp4FL8EghPw")
        try {
            compose.onNodeWithText("Test",useUnmergedTree=true).performClick()
            compose.onNodeWithText("Saved decks").performScrollTo().performClick()
            compose.waitUntil(10000) {compose.onAllNodesWithTag("load-saved-deck-${saved.id}").fetchSemanticsNodes().isNotEmpty()}
            compose.onNodeWithTag("load-saved-deck-${saved.id}").performScrollTo().performClick()
            if(compose.onAllNodesWithText("Replace current draft?").fetchSemanticsNodes().isNotEmpty()) compose.onNodeWithText("Load deck").performClick()
            compose.waitUntil(10000) {compose.onAllNodesWithText("Format: Commander ▾").fetchSemanticsNodes().isNotEmpty()}
            compose.onNodeWithText("Decklist").performScrollTo().assertTextContains(text)
            compose.onNodeWithText("Deck name").performScrollTo().performTextReplacement("Updated UI library fixture")
            compose.onNodeWithText("Update saved deck").performScrollTo().performClick()
            compose.waitUntil(10000) {library.get(saved.id)?.name=="Updated UI library fixture"}
            compose.onNodeWithText("Decklist").performScrollTo().performTextReplacement("Unsaved editing draft")
            compose.onNodeWithText("Saved decks").performScrollTo().performClick()
            compose.onNodeWithTag("load-saved-deck-${saved.id}").performScrollTo().performClick()
            compose.onNodeWithText("Replace current draft?").assertIsDisplayed()
            compose.onNodeWithText("Load deck").performClick()
            compose.waitUntil(10000) {compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()}
            compose.onNodeWithText("Decklist").performScrollTo().assertTextContains(text)
            compose.onNodeWithText("Saved decks").performScrollTo().performClick()
            compose.onNodeWithTag("delete-saved-deck-${saved.id}").performScrollTo().performClick()
            compose.onNodeWithText("Delete saved deck").performClick()
            compose.waitUntil(10000) {library.get(saved.id)==null}
            compose.onNodeWithText("Close").performClick()
            compose.onNodeWithText("Decklist").performScrollTo().assertTextContains(text)
        } finally {library.delete(saved.id);library.close()}
    }

}
