package id.universe.mobile.domain

import kotlin.test.Test
import kotlin.test.assertEquals

class MarkupTest {
    @Test
    fun starredWordsAreTheBoldOnes() {
        assertEquals(
            listOf(
                Run("Unit pegangan ", false),
                Run("DT4084", true),
                Run(" sedang ", false),
                Run("breakdown", true),
                Run(".", false),
            ),
            boldRuns("Unit pegangan **DT4084** sedang **breakdown**."),
        )
    }

    @Test
    fun anUnclosedStarIsPlainText() {
        assertEquals(listOf(Run("Kamu pegangan **DT4084", false)), boldRuns("Kamu pegangan **DT4084"))
        assertEquals(emptyList(), boldRuns(""))
    }
}
