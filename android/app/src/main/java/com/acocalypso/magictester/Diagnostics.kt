package com.acocalypso.magictester

import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Process
import org.json.JSONObject
import java.io.File
import java.io.OutputStream
import java.io.PrintStream
import java.time.Instant

/** Private, bounded logs shared through files by the coordinator and Forge processes. */
object Diagnostics {
    private const val FILE_LIMIT=2L*1024*1024
    private const val TOTAL_LIMIT=24L*1024*1024
    @Volatile private var context: Context?=null
    private var installed=false
    fun directory(context: Context)=File(context.filesDir,"diagnostics").apply { mkdirs() }
    fun processName(): String = try {
        if(Build.VERSION.SDK_INT>=28) Application.getProcessName() else File("/proc/self/cmdline").readText().substringBefore('\u0000')
    } catch(_:Throwable) { "unknown" }
    @Synchronized fun install(app: Context) {
        if(installed) return
        context=app.applicationContext; installed=true
        val previous=Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread,error ->
            captureCrash(app,thread,error)
            if(previous!=null) previous.uncaughtException(thread,error)
            else { Process.killProcess(Process.myPid()); kotlin.system.exitProcess(10) }
        }
        prune(app)
        event("app.starting","Application process started",details=JSONObject().put("appVersion",BuildConfig.VERSION_NAME).put("sdk",Build.VERSION.SDK_INT).put("process",processName()))
    }
    fun captureCrash(app: Context, thread: Thread, error: Throwable) {
        runCatching {
            val text="${Instant.now()} · ${processName()} · thread ${thread.name}\n${error.stackTraceToString()}\n"
            File(directory(app),"crash-${System.currentTimeMillis()}-${Process.myPid()}.txt").writeText(text.take(128*1024))
        }
        event("app.crashed",error.message ?: error.javaClass.simpleName,level="ERROR",error=error)
    }
    @Synchronized fun event(name: String, message: String, runId: String?=null, level: String="INFO", details: JSONObject?=null, error: Throwable?=null) {
        val app=context ?: return
        runCatching {
            val file=File(directory(app),"events-${Process.myPid()}.jsonl")
            if(file.length()>FILE_LIMIT) { val older=File(file.path+".1");older.delete();file.renameTo(older) }
            val item=JSONObject().put("time",Instant.now().toString()).put("timestamp",System.currentTimeMillis()).put("pid",Process.myPid()).put("process",processName())
                .put("level",level).put("event",name).put("message",message.take(8000)).put("runId",runId ?: JSONObject.NULL)
            details?.let { item.put("details",it) };error?.let { item.put("stack",it.stackTraceToString().take(64000)) }
            file.appendText(item.toString()+"\n")
        }
    }
    private fun prune(app: Context) = runCatching {
        val files=directory(app).listFiles().orEmpty().filter { it.isFile }.sortedBy { it.lastModified() }
        var total=files.sumOf { it.length() }
        for(file in files) if(System.currentTimeMillis()-file.lastModified()>7*86400000L || total>TOTAL_LIMIT) { val size=file.length();if(file.delete()) total-=size }
    }
    fun threadDump(app: Context, runId: String): File? = runCatching {
        val safe=runId.replace(Regex("[^A-Za-z0-9_-]"),"_").take(80)
        val file=File(directory(app),"threads-$safe-${Process.myPid()}-${System.currentTimeMillis()}.txt")
        file.writeText(buildString {
            append("${Instant.now()} · ${processName()} · run $runId\n")
            Thread.getAllStackTraces().entries.sortedBy { it.key.name }.forEach { (thread,stack) ->
                append("\n${thread.name} · ${thread.state}\n")
                stack.forEach { append("    at $it\n") }
            }
        }.take(128*1024))
        event("engine.thread_dump","Saved engine thread stacks",runId)
        file
    }.getOrNull()
    fun captureConsole(app: Context, runId: String): ConsoleCapture = ConsoleCapture(app,runId)
    class ConsoleCapture(app: Context, runId: String) {
        private val originalOut=System.out
        private val originalErr=System.err
        private val safe=runId.replace(Regex("[^A-Za-z0-9_-]"),"_").take(80)
        private val prefix="engine-$safe-${Process.myPid()}-${System.currentTimeMillis()}"
        private class Tee(private val original: PrintStream, private val file: File, private val runId: String): OutputStream() {
            private var written=0L
            private var truncated=false
            private val stream=runCatching { file.outputStream() }.getOrNull()
            override fun write(value: Int) { write(byteArrayOf(value.toByte()),0,1) }
            @Synchronized override fun write(bytes: ByteArray, offset: Int, count: Int) {
                original.write(bytes,offset,count)
                val remaining=(FILE_LIMIT-written).coerceAtLeast(0).coerceAtMost(count.toLong()).toInt()
                if(remaining>0) runCatching { stream?.write(bytes,offset,remaining);written+=remaining }
                if(remaining<count && !truncated) { truncated=true;event("engine.console_truncated","Engine console reached its 2 MiB retention limit",runId,level="WARN",details=JSONObject().put("file",file.name)) }
            }
            override fun flush() { runCatching { stream?.flush() };original.flush() }
            override fun close() { runCatching { stream?.close() } }
        }
        private val stdout=PrintStream(Tee(originalOut,File(directory(app),"$prefix-stdout.log"),runId),true,"UTF-8")
        private val stderr=PrintStream(Tee(originalErr,File(directory(app),"$prefix-stderr.log"),runId),true,"UTF-8")
        init { System.setOut(stdout);System.setErr(stderr) }
        fun restore() { System.setOut(originalOut);System.setErr(originalErr);stdout.close();stderr.close() }
    }
}
