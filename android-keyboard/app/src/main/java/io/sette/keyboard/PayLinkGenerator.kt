package io.sette.keyboard

/**
 * PayLinkGenerator (B.1)
 *
 * Generates secure pay links for SettePay escrow deals.
 * These links are injected into the Messenger composer via
 * the keyboard's InputConnection.
 */
object PayLinkGenerator {

    private const val BASE_URL = "https://app.sette.io/deals"

    /**
     * Generate a formatted pay link message for injection into
     * the Messenger composer.
     */
    fun generatePayLink(dealId: String, amount: Double): String {
        val formattedAmount = String.format("%.2f", amount)
        return "\uD83D\uDD12 SettePay Secure Deal — EGP $formattedAmount\n$BASE_URL/$dealId/pay"
    }

    /**
     * Generate a plain URL for the deal payment page.
     */
    fun generatePayUrl(dealId: String): String {
        return "$BASE_URL/$dealId/pay"
    }

    /**
     * Generate a deal status URL.
     */
    fun generateDealUrl(dealId: String): String {
        return "$BASE_URL/$dealId"
    }
}
