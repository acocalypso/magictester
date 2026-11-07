package com.acocalypso.magictester

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

@Composable fun PerformancePanel(model: Workbench) {
    val context=androidx.compose.ui.platform.LocalContext.current
    var currentDeck by remember {mutableStateOf(false)}
    var players by remember {mutableIntStateOf(4)}
    var selected by remember {mutableIntStateOf(PerformanceSettings.selected(context))}
    val format=if(currentDeck) model.format else "pauper"
    val profile=PerformanceSettings.profile(format,players)
    val report=remember(model.runs,model.performanceVersion,profile) {PerformanceSettings.report(context,profile)}
    val tested=maxOf(1,report?.optInt("maxStable",1) ?: 1)
    Text("Performance & parallel games",fontSize=20.sp)
    Text("The benchmark plays two real games per engine at each level, up to four isolated processes. It measures throughput, peak process memory, free memory and actual overlap. A foreground notification shows progress.",fontSize=13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
    Row {Checkbox(currentDeck,{currentDeck=it});Text("Use my current deck and selected opponents",Modifier.padding(top=12.dp),fontSize=13.sp)}
    if(currentDeck) {
        Text("Workload: ${model.format}. Use Test and Pools to choose the deck and opponents first.",fontSize=12.sp)
        if(model.format in listOf("commander","cedh")) {Text("Benchmark table: $players players");Slider(players.toFloat(),{players=it.toInt()},valueRange=2f..4f,steps=1)}
    } else Text("Quick workload: Pauper reference burn decks. Benchmark your Commander setup separately for a representative limit.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedButton(onClick={model.benchmark(currentDeck,players)},enabled=!model.busy && !model.firstSetup) {Text("Run device performance test")}
    if(report==null) Text("No benchmark for this workload yet. Parallel play remains limited to one engine.",fontSize=12.sp)
    report?.let { data ->
        Text("Recommended: ${data.optInt("recommended",1)} · Highest validated: ${data.optInt("maxStable")}",fontSize=14.sp,color=MaterialTheme.colorScheme.primary)
        val samples=data.optJSONArray("samples")
        if(samples!=null) for(i in 0 until samples.length()) {
            val sample=samples.getJSONObject(i)
            Text("${sample.optInt("parallelism")} engines · ${"%.2f".format(sample.optDouble("gamesPerMinute"))} games/min · ${sample.optLong("peakProcessPssMiB")} MiB peak/engine · ${if(sample.optBoolean("stable")) "passed" else "not validated"}",fontSize=12.sp)
            if(!sample.optBoolean("stable")) Text(sample.optString("reason"),fontSize=12.sp,color=MaterialTheme.colorScheme.error)
        }
        if(data.has("stoppedReason")) Text(data.optString("stoppedReason"),fontSize=12.sp)
    }
    Row {Checkbox(selected==0,{checked->selected=if(checked) 0 else 1;PerformanceSettings.select(context,selected);model.performanceVersion++});Text("Automatically use the benchmark recommendation",Modifier.padding(top=12.dp),fontSize=13.sp)}
    if(selected!=0) {
        Text("Parallel-game limit: $selected")
        Slider(selected.coerceAtMost(tested).toFloat(),{selected=it.toInt().coerceIn(1,tested);PerformanceSettings.select(context,selected);model.performanceVersion++},valueRange=1f..maxOf(2,tested).toFloat(),steps=maxOf(0,tested-2),enabled=tested>1)
    }
    Text("Effective limit for this workload: ${PerformanceSettings.limit(context,profile)}. Settings apply to the next group of matches. Free memory and thermal checks can reduce actual concurrency. BO3 games within each match stay sequential.",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
}
