package com.acocalypso.magictester

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipInputStream

object EngineAssets {
    fun install(context: Context, progress: (String, Float?) -> Unit): File {
        val manifest = JSONObject(context.assets.open("engine-manifest.json").bufferedReader().use { it.readText() })
        val digest = manifest.getString("dataSha256")
        val home = File(context.filesDir, "engines/$digest")
        if (File(home, ".ready").readTextOrNull() == digest) return home
        progress("Verifying bundled Forge ${manifest.getString("version")}", null)
        val sha = MessageDigest.getInstance("SHA-256")
        context.assets.open("forge-data.zip").use { input ->
            val buffer = ByteArray(131072)
            while (true) { val n = input.read(buffer); if (n < 0) break; sha.update(buffer, 0, n) }
        }
        check(sha.digest().joinToString("") { "%02x".format(it) } == digest) { "Engine data checksum mismatch. Reinstall the app." }
        val required = manifest.optLong("dataUncompressedBytes", 160L*1024*1024) + 32L*1024*1024
        check(context.filesDir.usableSpace > required) { "Free at least ${required/1048576} MiB of storage, then retry setup." }
        val stage = File(context.filesDir, "engines/$digest.partial")
        stage.deleteRecursively(); check(stage.mkdirs())
        try {
            val total = context.assets.openFd("forge-data.zip").use { it.length }
            var bytes = 0L
            val counting = object : java.io.FilterInputStream(context.assets.open("forge-data.zip")) {
                override fun read(b: ByteArray, off: Int, len: Int): Int {
                    val n = super.read(b, off, len)
                    if (n > 0) { bytes += n; progress("Installing engine data · ${bytes / 1048576} / ${total / 1048576} MiB", (bytes.toFloat() / total).coerceIn(0f, 1f)) }
                    return n
                }
            }
            ZipInputStream(counting).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    val target = File(stage, entry.name).canonicalFile
                    check(target.path.startsWith(stage.canonicalPath + File.separator)) { "Unsafe engine archive path" }
                    if (entry.isDirectory) target.mkdirs() else {
                        check(target.parentFile!!.isDirectory || target.parentFile!!.mkdirs())
                        target.outputStream().use { zip.copyTo(it) }
                    }
                    zip.closeEntry()
                }
            }
            File(stage, ".ready").writeText(digest)
            if (home.exists()) home.deleteRecursively()
            check(stage.renameTo(home)) { "Could not activate engine data" }
            progress("Forge ${manifest.getString("version")} installed", 1f)
            return home
        } catch (error: Throwable) { stage.deleteRecursively(); throw error }
    }
    private fun File.readTextOrNull() = if (isFile) readText() else null
}
