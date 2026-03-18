package io.sette.keyboard

import android.inputmethodservice.InputMethodService
import android.view.View
import android.widget.Button

/**
 * SettepayKeyboardService (B.2)
 *
 * Main entry point for the SettePay Smart Seller Keyboard.
 * Implements Android's InputMethodService API to provide a custom
 * keyboard with a SettePay escrow deal creation panel.
 *
 * BRD Section 5.1 — Android Smart Seller Keyboard v1 (Phase 1)
 */
class SettepayKeyboardService : InputMethodService() {

    override fun onCreateInputView(): View {
        val view = layoutInflater.inflate(R.layout.keyboard_panel, null)

        view.findViewById<Button>(R.id.btn_generate_pay_link)?.setOnClickListener {
            showDealCreationSheet()
        }

        return view
    }

    /**
     * Opens the deal creation bottom sheet where the seller can
     * enter amount and description, then inject a pay link into
     * the active text field (Messenger composer).
     */
    private fun showDealCreationSheet() {
        val bottomSheet = DealPanelFragment()
        bottomSheet.onDealCreated = { payLink ->
            // Inject link directly into the active text field (Messenger composer)
            currentInputConnection?.commitText(payLink, 1)
        }
        // Note: InputMethodService does not have supportFragmentManager.
        // In production, use a Dialog or PopupWindow instead.
        // bottomSheet.show(supportFragmentManager, "deal_creation")
    }
}
