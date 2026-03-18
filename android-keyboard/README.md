# SettePay Android Smart Seller Keyboard

> BRD Section 5.1 — Phase 1 Deliverable

Android Smart Keyboard that enables Facebook Marketplace sellers to create escrow deals directly from the Messenger composer.

## Architecture

| Component | Description |
|---|---|
| `SettepayKeyboardService.kt` | Main `InputMethodService` entry point |
| `DealPanelFragment.kt` | Deal creation bottom sheet UI |
| `AuthTokenManager.kt` | Secure JWT storage (AES-256 + KeyStore) |
| `SettepayApiClient.kt` | API calls to `/api/v1/deals` |
| `PayLinkGenerator.kt` | Generates `bot.sette.io/deal/{id}` links |

## Security (B.3)

- JWT stored in Android `EncryptedSharedPreferences` (AES-256 + KeyStore)
- API calls use HTTPS only; certificate pinning configured for SettePay API domain
- The keyboard does NOT log keystrokes from other apps
- On token expiry (401), shows in-panel prompt to re-authenticate

## Build

```bash
cd android-keyboard
./gradlew assembleDebug
```

## Testing

Test on 3+ Android devices with Messenger installed:
1. Install APK
2. Enable keyboard in Settings > Language & Input
3. Open Messenger conversation
4. Switch to SettePay keyboard
5. Tap "Create Escrow Deal"
6. Enter amount and description
7. Verify pay link is injected into composer
