package io.sette.keyboard

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.lifecycle.lifecycleScope
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import kotlinx.coroutines.launch

/**
 * DealPanelFragment (B.2)
 *
 * Bottom sheet dialog for creating escrow deals directly from
 * the keyboard. Seller enters amount and description, and the
 * generated pay link is injected into the Messenger composer.
 */
class DealPanelFragment : BottomSheetDialogFragment() {

    var onDealCreated: ((String) -> Unit)? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.deal_create, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val amountInput = view.findViewById<EditText>(R.id.input_amount)
        val descriptionInput = view.findViewById<EditText>(R.id.input_description)
        val createButton = view.findViewById<Button>(R.id.btn_create_deal)

        createButton.setOnClickListener {
            val amountText = amountInput.text.toString().trim()
            val description = descriptionInput.text.toString().trim()

            val amount = amountText.toDoubleOrNull()
            if (amount == null || amount < 50) {
                Toast.makeText(context, "Minimum deal is EGP 50", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            if (description.length < 3) {
                Toast.makeText(context, "Please describe the item", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            createDeal(amount, description)
        }
    }

    private fun createDeal(amount: Double, description: String) {
        lifecycleScope.launch {
            val jwt = AuthTokenManager.getToken(requireContext())
            if (jwt == null) {
                showLoginPrompt()
                return@launch
            }

            val result = SettepayApiClient.createDeal(jwt, amount, description)
            result.fold(
                onSuccess = { deal ->
                    val payLink = "https://app.sette.io/deals/${deal.id}/pay"
                    onDealCreated?.invoke(
                        "\uD83D\uDD12 SettePay Secure Deal — EGP ${deal.amount}\n$payLink"
                    )
                    dismiss()
                },
                onFailure = { error ->
                    Toast.makeText(
                        context,
                        "Failed to create deal: ${error.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            )
        }
    }

    private fun showLoginPrompt() {
        Toast.makeText(
            context,
            "Please log in to SettePay first",
            Toast.LENGTH_LONG
        ).show()
        // TODO: Deep-link to SettePay app login
    }
}
