package com.acocalypso.magictester
import android.content.Context
import org.json.JSONObject

object EngineBuild {
    @Volatile private var cached: String?=null
    fun fingerprint(context: Context): String = cached ?: context.assets.open("engine-manifest.json").bufferedReader().use {
        JSONObject(it.readText()).getString("engineJarSha256")
    }.also {cached=it}
    fun requireExpected(expected: String,actual: String) {
        require(expected.isEmpty() || expected==actual) {"This analysis was created with a different engine build. Start a new analysis so saved results do not mix AI implementations."}
    }
    fun annotate(event: JSONObject,fingerprint: String,version: String) {
        event.optJSONObject("result")?.let { result ->
            result.put("engineBuildSha256",fingerprint).put("appVersion",version)
            result.optJSONArray("games")?.let {games -> for(i in 0 until games.length()) games.getJSONObject(i).put("engineBuildSha256",fingerprint).put("appVersion",version)}
        }
    }
}
