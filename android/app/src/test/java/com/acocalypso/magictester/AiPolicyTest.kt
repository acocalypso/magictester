package com.acocalypso.magictester
import org.junit.Test
import org.junit.Assert.*

class AiPolicyTest {
    @Test fun normalAnalysisUsesTheSamePolicyAtEverySeat() {
        for(count in 2..4) {
            assertEquals(List(count) {"stable"},AiPolicy.seats(AiPolicy.STABLE,count))
            assertEquals(List(count) {"tactical-v1"},AiPolicy.seats(AiPolicy.TACTICAL,count))
        }
    }
    @Test fun unknownImportedPoliciesAndUnsupportedTablesAreRejected() {
        for(id in listOf("","strongest","tactical-v2")) {
            try {AiPolicy.checked(id);fail("Unknown imported policy accepted")} catch(_:IllegalArgumentException) {}
        }
        for(count in listOf(1,5)) {
            try {AiPolicy.seats(AiPolicy.STABLE,count);fail("Unsupported table accepted")} catch(_:IllegalArgumentException) {}
        }
    }
    @Test fun labelsDistinguishExperimentalAndUnknownEvidence() {
        assertEquals("Native Forge",AiPolicy.label(AiPolicy.STABLE))
        assertTrue(AiPolicy.label(AiPolicy.TACTICAL).contains("experimental"))
        assertTrue(AiPolicy.label("old-policy").contains("Unrecognized"))
    }
}
