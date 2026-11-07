package com.acocalypso.magictester

import android.os.SystemClock
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner

@Composable fun LiveGamePanel(run: Run, compact: Boolean=false) {
    val all=run.liveGames
    val active=all.filter { run.state=="running" && it.optBoolean("active") }
    val visible=if(active.isNotEmpty()) active else all.takeLast(1)
    if(visible.isEmpty()) {
        if(run.state=="running" && !compact) Text("Preparing the engine. The game clock starts when play begins.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    if(active.size>1) Text("${active.size} games running in parallel",fontSize=12.sp,color=MaterialTheme.colorScheme.primary)
    for(game in visible) key(game.optInt("unitIndex")) { GameTimeItem(run,game,compact) }
}
@Composable private fun GameTimeItem(run: Run,game: org.json.JSONObject,compact: Boolean) {
    val active=run.state=="running" && game.optBoolean("active")
    val started=game.optLong("startedElapsedMs")
    var now by remember(run.id,started,active) { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    val owner=LocalLifecycleOwner.current
    LaunchedEffect(run.id,started,active,owner) {
        if(active) owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { while(true) { now=SystemClock.elapsedRealtime();delay(1000) } }
    }
    val elapsed=GameClock.elapsed(started,now,active,game.optLong("elapsedMs"))
    val budget=game.optInt("clockSeconds",run.payload.optInt("clockSeconds",120))*1000L
    val status=when {
        active -> "elapsed"
        game.optBoolean("estimated") -> "last recorded"
        game.optString("termination") in listOf("normal","rule_draw") -> "finished in"
        else -> "stopped after"
    }
    Column(verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Text("Match ${game.optInt("unitIndex")+1} · Game ${game.optInt("gameIndex")+1}",fontSize=if(compact) 11.sp else 12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Text("${GameClock.format(elapsed)} $status · ${GameClock.format(budget)} limit",fontFamily=FontFamily.Monospace,fontSize=if(compact) 12.sp else 18.sp,color=MaterialTheme.colorScheme.primary)
        if(active && !compact) {
            LinearProgressIndicator(progress={if(budget>0) (elapsed.toFloat()/budget).coerceIn(0f,1f) else 0f},modifier=Modifier.fillMaxWidth())
            Text(if(elapsed<budget) "${GameClock.format(budget-elapsed)} remaining in this game's time budget" else "Time limit reached. Waiting for Forge to return its final evidence.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
