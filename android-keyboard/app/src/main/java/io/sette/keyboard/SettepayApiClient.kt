package io.sette.keyboard

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * SettepayApiClient (B.1)
 *
 * Makes API calls to the SettePay backend (/api/v1/deals).
 * Uses HTTPS only; certificate pinning recommended for production.
 */
object SettepayApiClient {

    private const val BASE_URL = "https://api.sette.io/api/v1"

    data class DealResponse(val id: String, val amount: Double)

    suspend fun createDeal(
        jwt: String,
        amount: Double,
        description: String
    ): Result<DealResponse> = withContext(Dispatchers.IO) {
        try {
            val url = URL("$BASE_URL/deals")
            val connection = url.openConnection() as HttpURLConnection

            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $jwt")
            connection.doOutput = true
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000

            val body = JSONObject().apply {
                put("amount", amount)
                put("itemDescription", description)
                put("source", "android_keyboard")
            }

            connection.outputStream.bufferedWriter().use {
                it.write(body.toString())
            }

            val responseCode = connection.responseCode

            if (responseCode == 401) {
                return@withContext Result.failure(
                    Exception("Authentication expired. Please log in again.")
                )
            }

            if (responseCode !in 200..299) {
                val errorBody = connection.errorStream?.bufferedReader()?.readText() ?: "Unknown error"
                return@withContext Result.failure(
                    Exception("API error ($responseCode): $errorBody")
                )
            }

            val responseBody = connection.inputStream.bufferedReader().readText()
            val json = JSONObject(responseBody)

            Result.success(
                DealResponse(
                    id = json.getString("id"),
                    amount = json.getDouble("amount")
                )
            )
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
