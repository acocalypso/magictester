package com.acocalypso.magictester

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.json.JSONObject

object BackgroundRunStatus {
    fun snapshot(context: Context)=JSONObject()
        .put("batteryOptimizationExempt",context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName))
        .put("notificationsEnabled",NotificationManagerCompat.from(context).areNotificationsEnabled())
        .put("keepScreenOnDuringRuns",context.getSharedPreferences("workbench",0).getBoolean("keepScreenOnDuringRuns",false))

    fun open(context: Context,action: String,appDetails: Boolean=false) {
        val intent=Intent(action).apply {if(appDetails) data=Uri.parse("package:${context.packageName}")}
        runCatching {context.startActivity(intent)}.onFailure {
            Diagnostics.event("settings.unavailable","This device could not open $action",level="WARN",error=it)
        }
    }
}

@Composable fun BackgroundRunPanel(model: Workbench) {
    val context=LocalContext.current
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    var state by remember {mutableStateOf(BackgroundRunStatus.snapshot(context))}
    DisposableEffect(lifecycle) {
        val observer=LifecycleEventObserver {_,event->if(event==Lifecycle.Event.ON_RESUME) state=BackgroundRunStatus.snapshot(context)}
        lifecycle.addObserver(observer)
        onDispose {lifecycle.removeObserver(observer)}
    }
    Text("Long runs & background activity",fontSize=19.sp)
    Text(if(state.optBoolean("batteryOptimizationExempt")) "Android battery optimization exemption is enabled" else "Android battery optimization is enabled for MagicTester",fontSize=13.sp)
    Text(if(state.optBoolean("notificationsEnabled")) "Analysis notifications are allowed" else "Analysis notifications are disabled. Enable them in Android app settings to keep progress and cancellation visible.",fontSize=13.sp)
    Text("On OnePlus / OxygenOS, open app settings and allow background activity or choose Unrestricted battery use. Menu names vary. Android can still stop the app; unfinished analyses recover from saved matches when Android restarts the service or you reopen the app. After two automatic recoveries, use Resume to try again. Performance tests require manual rerun.",fontSize=13.sp)
    OutlinedButton(onClick={BackgroundRunStatus.open(context,Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)}) {Text("Open battery optimization settings")}
    OutlinedButton(onClick={BackgroundRunStatus.open(context,Settings.ACTION_APPLICATION_DETAILS_SETTINGS,true)}) {Text("Open MagicTester app settings")}
    Row {
        Switch(checked=model.keepScreenOnDuringRuns,onCheckedChange={model.chooseKeepScreenOnDuringRuns(it)})
        Text("Keep screen awake while a run is active and the app is visible",fontSize=13.sp)
    }
    Text("Keeping the screen awake uses more battery and can add heat. It switches off when no analysis is running.",fontSize=12.sp)
}
