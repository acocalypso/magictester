package com.acocalypso.magictester

/** Frozen policy and scope settings for normal analyses and controlled comparisons. */
object AiPolicy {
    const val STABLE="stable"
    const val TACTICAL="tactical-v1"
    const val EXPANDED="tactical-v2"
    const val STRATEGIC="strategic-v1"
    const val ALL="all-seats"
    const val YOUR_DECK="your-deck-only"
    val options=listOf(STABLE,TACTICAL,EXPANDED,STRATEGIC)
    fun checked(id: String): String {
        require(id in options) {"Unsupported AI policy: $id. Create a new analysis with a supported policy."}
        return id
    }
    fun checkedScope(scope: String): String {
        require(scope==ALL || scope==YOUR_DECK) {"Unsupported AI policy scope: $scope."}
        return scope
    }
    fun seats(id: String,count: Int,scope: String=ALL): List<String> {
        checked(id);checkedScope(scope)
        require(count in 2..4) {"An analysis needs two to four seats."}
        return List(count) {if(scope==YOUR_DECK && it>0) STABLE else id}
    }
    fun label(id: String): String = when(id) {
        STABLE -> "Native Forge"
        TACTICAL -> "Tactical v1 · experimental"
        EXPANDED -> "Expanded v2 · experimental"
        STRATEGIC -> "Strategic v1 · experimental"
        else -> "Unrecognized policy ($id)"
    }
    fun scopeLabel(scope: String)=if(scope==YOUR_DECK) "your deck; native opponents" else "all seats"
}
