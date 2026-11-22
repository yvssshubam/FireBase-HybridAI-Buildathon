package com.fairclaim.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class EngineVectorsTest {
    private val runner = VectorRunner.fromSystemProperties()

    private fun assertNoFailures(failures: List<String>) =
        assertTrue("${failures.size} vector(s) failed:\n" + failures.joinToString("\n"), failures.isEmpty())

    @Test fun engineVectors() = assertNoFailures(runner.engine())

    @Test fun counterEvidenceVectors() = assertNoFailures(runner.counterEvidence())

    @Test fun modelOutputVectors() = assertNoFailures(runner.modelOutput())

    @Test fun itemMatchVectors() = assertNoFailures(runner.itemMatch())

    @Test fun vectorsAreNotEmpty() {
        assertTrue(runner.count("engine.vectors.json") >= 80)
        assertTrue(runner.count("model-output.vectors.json") >= 30)
    }
}

class PolicyTest {
    private val policyText = File(System.getProperty("fairclaim.policy")).readText()

    @Test fun parsesBundledPolicy() {
        val p = policyFromJsonString(policyText)
        assertEquals("v1", p.policyVersion)
        assertEquals(500L, p.autoApproveCap)
        assertEquals(600, p.severityPermille.partial)
    }

    @Test fun rejectsFactorAboveHundredPercent() {
        assertThrows(IllegalArgumentException::class.java) {
            policyFromJsonString(policyText.replace("\"total\": 1000", "\"total\": 1001"))
        }
    }

    @Test fun rejectsUnknownKey() {
        assertThrows(IllegalArgumentException::class.java) {
            policyFromJsonString(policyText.replaceFirst("{", "{\"refundEverything\": true,"))
        }
    }
}
