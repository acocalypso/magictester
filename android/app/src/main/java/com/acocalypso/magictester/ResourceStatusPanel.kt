package com.acocalypso.magictester

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

@Composable fun ResourceStatusPanel() {
    val context=androidx.compose.ui.platform.LocalContext.current
    val owner=LocalLifecycleOwner.current
    var sample by remember {mutableStateOf(PerformanceSettings.resources(context))}
    LaunchedEffect(owner) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while(true) {sample=withContext(Dispatchers.IO) {PerformanceSettings.resources(context)};delay(3000)}
        }
    }
    val budget=PerformanceSettings.processBudgetMiB(context,"constructed")
    val available=sample.getLong("availableMiB")
    val thermal=sample.getInt("thermal")
    val pressure=sample.getBoolean("lowMemory")
    Text("Live device resources",fontSize=19.sp)
    Text("${sample.getLong("totalMiB")} MiB physical RAM · $available MiB available\nAndroid memory-pressure flag: ${if(pressure) "yes" else "no"} · threshold ${sample.optLong("memoryThresholdMiB")} MiB\nThermal status: ${PerformanceSettings.thermalLabel(thermal)} ($thermal) · per-process heap limit ${sample.getInt("largeHeapMiB")} MiB",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
    Text(when {
        thermal>=4 -> "Startup is waiting for Android's critical thermal status to clear."
        available<budget+CapacityMath.SINGLE_RESERVE_MIB -> "One engine needs ${budget+CapacityMath.SINGLE_RESERVE_MIB} MiB available ($budget MiB budget + ${CapacityMath.SINGLE_RESERVE_MIB} MiB headroom). Close other apps and retry."
        pressure || thermal>=3 -> "One engine can start. Android's advisory currently limits work to a single process."
        else -> "Memory and thermal checks allow one engine to start. Parallel capacity is measured separately below."
    },fontSize=12.sp,color=if(thermal>=4 || available<budget+CapacityMath.SINGLE_RESERVE_MIB) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
}
