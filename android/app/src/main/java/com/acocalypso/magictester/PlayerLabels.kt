package com.acocalypso.magictester

/** Display aliases for existing evidence; recorded engine identities stay intact. */
object PlayerLabels {
    fun name(seat: Int)=if(seat==0) "You" else "Opponent $seat"
    private val token=Regex("(?<![A-Za-z0-9_-])player-(\\d+)(['’]s)?(?![A-Za-z0-9_-])",RegexOption.IGNORE_CASE)
    private val agreement=Regex("\\bYou (is|was|has|does)\\b")
    fun readable(text: String): String {
        val labels=token.replace(text) {match ->
            val seat=match.groupValues[1].toIntOrNull()
            if(seat==null || seat !in 0..3) match.value else if(match.groupValues[2].isNotEmpty()) {
                if(seat==0) "Your" else "${name(seat)}'s"
            } else name(seat)
        }
        return agreement.replace(labels) {"You "+when(it.groupValues[1]) {"is"->"are";"was"->"were";"has"->"have";else->"do"}}
    }
}
