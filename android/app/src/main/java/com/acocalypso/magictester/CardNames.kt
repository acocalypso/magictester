package com.acocalypso.magictester

/** Keep the full card name while using Scryfall collection's front-face identifier. */
object CardNames {
    private val separator=Regex("\\s*//\\s*")
    fun normalized(name: String)=name.trim().replace(separator," // ")
    fun identifier(name: String)=normalized(name).substringBefore(" // ")
    fun matches(requested: String,canonical: String): Boolean {
        val name=normalized(requested)
        return name.equals(normalized(canonical),true) || name.equals(identifier(canonical),true)
    }
}
