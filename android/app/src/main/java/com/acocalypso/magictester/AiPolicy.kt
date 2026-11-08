package com.acocalypso.magictester

/** Versioned run setting. One policy pilots every deck in a normal analysis. */
object AiPolicy {
    const val STABLE="stable"
    const val TACTICAL="tactical-v1"
    fun checked(id: String): String {
        require(id==STABLE || id==TACTICAL) {"Unsupported AI policy: $id. Create a new analysis with a supported policy."}
        return id
    }
    fun seats(id: String,count: Int): List<String> {
        checked(id)
        require(count in 2..4) {"An analysis needs two to four seats."}
        return List(count) {id}
    }
    fun label(id: String): String = when(id) {
        STABLE -> "Native Forge"
        TACTICAL -> "Tactical v1 · experimental"
        else -> "Unrecognized policy ($id)"
    }
}
