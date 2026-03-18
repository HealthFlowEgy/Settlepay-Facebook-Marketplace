package io.sette.keyboard

import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.inputmethodservice.InputMethodService
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * SettepayKeyboardService (B.2 — Fixed: HI-08)
 *
 * HI-08 fix: InputMethodService does NOT have supportFragmentManager.
 * Replaced BottomSheetDialogFragment with a TYPE_APPLICATION_OVERLAY Dialog
 * using WindowManager — the correct pattern for IME overlays.
 */
class SettepayKeyboardService : InputMethodService() {

    override fun onCreateInputView(): View {
        val view = layoutInflater.inflate(R.layout.keyboard_panel, null)
        view.findViewById<Button>(R.id.btn_generate_pay_link)?.setOnClickListener {
            showDealCreationDialog()
        }
        return view
    }

    /**
     * HI-08 fix: Use Dialog with WindowManager TYPE_APPLICATION_OVERLAY.
     * This is the correct approach for showing UI from an InputMethodService.
     */
    private fun showDealCreationDialog() {
        val jwt = AuthTokenManager.getToken(this)
        if (jwt == null) {
            showLoginPrompt()
            return
        }

        // Create dialog with application overlay type
        val dialog = Dialog(this, android.R.style.Theme_DeviceDefault_Light_Dialog_NoActionBar)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog.setContentView(R.layout.deal_create)
        dialog.window?.apply {
            setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY)
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN)
            setLayout(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
            )
        }

        val etAmount      = dialog.findViewById<EditText>(R.id.et_amount)
        val etDescription = dialog.findViewById<EditText>(R.id.et_description)
        val btnCreate     = dialog.findViewById<Button>(R.id.btn_create_deal)
        val btnCancel     = dialog.findViewById<Button>(R.id.btn_cancel)
        val tvStatus      = dialog.findViewById<TextView>(R.id.tv_status)

        btnCancel?.setOnClickListener { dialog.dismiss() }

        btnCreate?.setOnClickListener {
            val amountText = etAmount?.text?.toString()?.trim() ?: ""
            val description = etDescription?.text?.toString()?.trim() ?: ""

            if (amountText.isEmpty() || description.isEmpty()) {
                tvStatus?.text = "Please fill in all fields"
                return@setOnClickListener
            }

            val amount = amountText.toDoubleOrNull()
            if (amount == null || amount < 50 || amount > 50000) {
                tvStatus?.text = "Amount must be between EGP 50 and EGP 50,000"
                return@setOnClickListener
            }

            btnCreate.isEnabled = false
            tvStatus?.text = "Creating secure deal..."

            CoroutineScope(Dispatchers.IO).launch {
                val result = SettepayApiClient.createDeal(jwt, amount, description)
                withContext(Dispatchers.Main) {
                    result.fold(
                        onSuccess = { deal ->
                            val payLink = PayLinkGenerator.generate(deal.id)
                            // Inject pay link into active text field (Messenger composer)
                            currentInputConnection?.commitText(payLink, 1)
                            dialog.dismiss()
                            Toast.makeText(this@SettepayKeyboardService, "Pay link inserted!", Toast.LENGTH_SHORT).show()
                        },
                        onFailure = { error ->
                            btnCreate.isEnabled = true
                            if (error.message?.contains("401") == true) {
                                AuthTokenManager.clearToken(this@SettepayKeyboardService)
                                tvStatus?.text = "Session expired. Please log in again."
                                showLoginPrompt()
                                dialog.dismiss()
                            } else {
                                tvStatus?.text = "Error: ${error.message}"
                            }
                        },
                    )
                }
            }
        }

        dialog.show()
    }

    private fun showLoginPrompt() {
        Toast.makeText(
            this,
            "Please log in to SettePay first. Open the SettePay app to sign in.",
            Toast.LENGTH_LONG,
        ).show()
    }
}
