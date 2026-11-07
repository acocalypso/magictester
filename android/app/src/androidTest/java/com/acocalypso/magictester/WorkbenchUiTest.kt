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
    @Test fun firstRunAndNavigationAreReadable() {
        compose.onNodeWithText("MagicTester").assertIsDisplayed()
        compose.onNodeWithText("Setup",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Set up local engine").assertIsDisplayed()
        compose.onNodeWithText("Export diagnostic logs").performScrollTo().performClick()
        compose.onNodeWithText("Include complete decklists").assertIsDisplayed()
        compose.onNodeWithText("Cancel").performClick()
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
}
