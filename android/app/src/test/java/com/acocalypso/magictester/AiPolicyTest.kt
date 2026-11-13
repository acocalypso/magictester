package com.acocalypso.magictester
import org.junit.Test
import org.junit.Assert.*

class AiPolicyTest {
    @Test fun normalAnalysisUsesTheSamePolicyAtEverySeat() {
        for(count in 2..4) {
            assertEquals(List(count) {"stable"},AiPolicy.seats(AiPolicy.STABLE,count))
            assertEquals(List(count) {"tactical-v1"},AiPolicy.seats(AiPolicy.TACTICAL,count))
            assertEquals(List(count) {"strategic-v1"},AiPolicy.seats(AiPolicy.STRATEGIC,count))
            assertEquals(List(count) {"strategic-v2"},AiPolicy.seats(AiPolicy.ADAPTIVE,count))
            assertEquals(listOf(AiPolicy.STRATEGIC)+List(count-1) {AiPolicy.STABLE},AiPolicy.seats(AiPolicy.STRATEGIC,count,AiPolicy.YOUR_DECK))
        }
    }
    @Test fun unknownImportedPoliciesAndUnsupportedTablesAreRejected() {
        for(id in listOf("","strongest","tactical-v3")) {
            try {AiPolicy.checked(id);fail("Unknown imported policy accepted")} catch(_:IllegalArgumentException) {}
        }
        for(count in listOf(1,5)) {
            try {AiPolicy.seats(AiPolicy.STABLE,count);fail("Unsupported table accepted")} catch(_:IllegalArgumentException) {}
        }
    }
    @Test fun expandedComparisonKeepsOpponentsNativeAtEveryTableSize() {
        for(count in 2..4) {
            assertEquals(List(count) {AiPolicy.EXPANDED},AiPolicy.seats(AiPolicy.EXPANDED,count))
            val paired=AiPolicy.seats(AiPolicy.EXPANDED,count,AiPolicy.YOUR_DECK)
            assertEquals(AiPolicy.EXPANDED,paired.first())
            assertTrue(paired.drop(1).all {it==AiPolicy.STABLE})
        }
        try {AiPolicy.seats(AiPolicy.EXPANDED,4,"unknown");fail("Invalid scope accepted")}catch(_:IllegalArgumentException) {}
    }
    @Test fun labelsDistinguishExperimentalAndUnknownEvidence() {
        assertEquals("Native Forge",AiPolicy.label(AiPolicy.STABLE))
        assertTrue(AiPolicy.label(AiPolicy.TACTICAL).contains("experimental"))
        assertEquals("Strategic v2 · experimental",AiPolicy.label(AiPolicy.ADAPTIVE))
        assertTrue(AiPolicy.label("old-policy").contains("Unrecognized"))
    }
}
