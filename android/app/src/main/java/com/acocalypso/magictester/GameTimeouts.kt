package com.acocalypso.magictester

object GameTimeouts {
    fun maximumSeconds(format: String)=if(DeckText.commander(format)) 1800 else 300
    fun defaultSeconds(format: String)=if(DeckText.commander(format)) 900 else 120
    fun accepts(format: String,seconds: Int)=format in DeckText.formats && seconds in 5..maximumSeconds(format)
}
