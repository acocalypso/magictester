package com.acocalypso.magictester
import org.junit.Test
import org.junit.Assert.*
class CapacityMathTest {
    @Test fun memoryAndCpuCapsLeaveHeadroom() {
        assertEquals(1,CapacityMath.cpuLimit(1));assertEquals(2,CapacityMath.cpuLimit(4));assertEquals(4,CapacityMath.cpuLimit(16))
        assertEquals(0,CapacityMath.memoryLimit(500,4096,512))
        assertEquals(2,CapacityMath.memoryLimit(2048,4096,512))
        assertEquals(1,CapacityMath.memoryLimit(1536,4096,512))
    }
    @Test fun slowerOrMarginalParallelismIsNotRecommended() {
        assertEquals(1,CapacityMath.recommendation(listOf(1 to 4.0,2 to 4.1,3 to 3.5)))
        assertEquals(2,CapacityMath.recommendation(listOf(1 to 4.0,2 to 7.0,3 to 7.1,4 to 6.9)))
    }
}
