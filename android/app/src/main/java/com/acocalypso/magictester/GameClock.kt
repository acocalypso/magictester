package com.acocalypso.magictester

/** Uses the device's monotonic clock, so changing wall time cannot alter gameplay elapsed time. */
object GameClock {
    fun elapsed(startedElapsedMs: Long, nowElapsedMs: Long, active: Boolean, recordedMs: Long): Long =
        if(active && nowElapsedMs>=startedElapsedMs) maxOf(recordedMs,nowElapsedMs-startedElapsedMs).coerceAtLeast(0) else recordedMs.coerceAtLeast(0)
    fun format(milliseconds: Long): String {
        val seconds=milliseconds.coerceAtLeast(0)/1000
        return "${seconds/60}:${(seconds%60).toString().padStart(2,'0')}"
    }
}
