package com.acocalypso.magictester

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.sp

@Composable fun GameTimeoutControl(format: String,seconds: Int,onChange: (Int)->Unit) {
    val maximum=GameTimeouts.maximumSeconds(format)
    Text("Game timeout: $seconds seconds (${seconds/60}m ${seconds%60}s)")
    Slider(seconds.coerceIn(5,maximum).toFloat(),{onChange((it.toInt()/5*5).coerceIn(5,maximum))},valueRange=5f..maximum.toFloat(),steps=(maximum-5)/5-1)
    if(DeckText.commander(format)) Text("Commander games can run for up to 30 minutes each. Longer limits allow more time to finish; timed-out games remain unfinished evidence.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
}
