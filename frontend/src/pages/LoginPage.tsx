import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { T, Input, Btn } from "../components/ui";
import { authApi } from "../api";

export default function LoginPage({ onLogin }: { onLogin: (user: any, token: string) => void }) {
  const [step, setStep]           = useState<"info" | "otp">("info");
  const [mobile, setMobile]       = useState("");
  const [firstName, setFirst]     = useState("");
  const [lastName, setLast]       = useState("");
  const [isProvider, setProvider] = useState(false);
  const [otp, setOtp]             = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");

  async function sendOtp() {
    if (!mobile.match(/^\+?[\d\s]{10,15}$/)) { setError("Enter a valid Egyptian mobile (e.g. +201000000000)"); return; }
    if (!firstName)                            { setError("First name is required"); return; }
    setLoading(true); setError("");
    try {
      await authApi.sendOtp(mobile, firstName, lastName);
      setStep("otp");
    } catch (e: any) {
      setError(e.response?.data?.message || "Failed to send OTP. Please try again.");
    } finally { setLoading(false); }
  }

  async function verifyOtp() {
    if (!otp) { setError("Please enter your OTP"); return; }
    setLoading(true); setError("");
    try {
      const res = await authApi.verifyOtp(mobile, otp, isProvider, firstName, lastName);
      onLogin(res.data.user, res.data.token);
    } catch (e: any) {
      setError(e.response?.data?.message || "Invalid OTP. Please check and try again.");
    } finally { setLoading(false); }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(135deg, ${T.navy} 0%, #0d2d3d 50%, #0a1f2e 100%)`,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      {/* Background decoration */}
      <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {[...Array(6)].map((_, i) => (
          <motion.div key={i}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.04, scale: 1 }}
            transition={{ delay: i * 0.15, duration: 1 }}
            style={{
              position: "absolute",
              width: 300 + i * 80, height: 300 + i * 80,
              borderRadius: "50%", border: `1px solid ${T.teal}`,
              top: `${10 + i * 8}%`, left: `${-10 + i * 5}%`,
            }} />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ width: "100%", maxWidth: 420, position: "relative" }}
      >
        {/* Logo block */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200 }}
          >
            <div style={{ fontSize: 42, fontWeight: 900, color: T.white, letterSpacing: -1.5, lineHeight: 1 }}>
              Sette<span style={{ color: T.teal }}>Pay</span>
            </div>
            <div style={{ color: T.teal, fontSize: 12, fontWeight: 700, letterSpacing: 3,
              textTransform: "uppercase", marginTop: 6 }}>
              Marketplace
            </div>
            <div style={{ color: "rgba(255,255,255,.4)", fontSize: 13, marginTop: 10 }}>
              Egypt's First Escrow-Protected Commerce
            </div>
          </motion.div>
        </div>

        {/* Auth card */}
        <div style={{
          background: "rgba(255,255,255,.97)",
          borderRadius: 20, boxShadow: "0 24px 64px rgba(0,0,0,.4)",
          overflow: "hidden",
        }}>
          {/* Progress bar */}
          <div style={{ height: 3, background: T.grey }}>
            <motion.div
              animate={{ width: step === "info" ? "50%" : "100%" }}
              style={{ height: "100%", background: T.teal, borderRadius: 2 }}
              transition={{ duration: 0.4 }}
            />
          </div>

          <div style={{ padding: 32 }}>
            <AnimatePresence mode="wait">
              {step === "info" ? (
                <motion.div key="info" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}
                  style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                  <div>
                    <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.dark }}>Create Account</h2>
                    <p style={{ margin: "6px 0 0", fontSize: 13, color: T.muted }}>
                      Step 1 of 2 — Your details
                    </p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Input label="First Name *" value={firstName}
                      onChange={(e: any) => setFirst(e.target.value)} placeholder="Ahmed" />
                    <Input label="Last Name" value={lastName}
                      onChange={(e: any) => setLast(e.target.value)} placeholder="Mohamed" />
                  </div>
                  <Input label="Mobile Number *" value={mobile}
                    onChange={(e: any) => setMobile(e.target.value)}
                    placeholder="+201000000000" type="tel"
                    hint="Egyptian mobile with country code" />

                  {/* Role selection */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.muted, marginBottom: 10 }}>
                      I am a...
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {[
                        { val: false, icon: "🛒", title: "Buyer", sub: "I buy from Facebook sellers" },
                        { val: true,  icon: "🏪", title: "Seller", sub: "I sell on Facebook Marketplace" },
                      ].map(r => (
                        <motion.button key={String(r.val)}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setProvider(r.val)}
                          style={{
                            padding: "14px 12px", borderRadius: 12, cursor: "pointer",
                            border: `2px solid ${isProvider === r.val ? T.teal : T.border}`,
                            background: isProvider === r.val ? T.tealL : T.white,
                            textAlign: "left", fontFamily: "inherit",
                          }}>
                          <div style={{ fontSize: 22 }}>{r.icon}</div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: T.dark, marginTop: 6 }}>{r.title}</div>
                          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{r.sub}</div>
                        </motion.button>
                      ))}
                    </div>
                  </div>

                  {error && (
                    <div style={{ background: T.redL, color: T.red, fontSize: 13,
                      padding: "10px 14px", borderRadius: 8 }}>⚠️ {error}</div>
                  )}

                  <Btn full loading={loading} onClick={sendOtp}>
                    Get Verification Code →
                  </Btn>
                </motion.div>
              ) : (
                <motion.div key="otp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}
                  style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                  <div>
                    <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.dark }}>Enter OTP</h2>
                    <p style={{ margin: "6px 0 0", fontSize: 13, color: T.muted }}>
                      Step 2 of 2 — Verify your number
                    </p>
                  </div>

                  <div style={{ background: T.tealL, borderRadius: 12, padding: "14px 18px" }}>
                    <div style={{ fontSize: 12, color: T.teal, fontWeight: 600 }}>Code sent to</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: T.dark, marginTop: 2 }}>{mobile}</div>
                  </div>

                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: T.muted,
                      display: "block", marginBottom: 8 }}>Verification Code</label>
                    <input
                      value={otp}
                      onChange={e => setOtp(e.target.value)}
                      placeholder="• • • •"
                      maxLength={6}
                      autoFocus
                      style={{
                        width: "100%", padding: "16px", borderRadius: 12, fontSize: 28,
                        textAlign: "center", letterSpacing: 12, fontWeight: 700,
                        border: `2px solid ${T.border}`, outline: "none",
                        fontFamily: "inherit", color: T.dark,
                        transition: "border-color .15s",
                      }}
                      onFocus={e  => (e.target.style.borderColor = T.teal)}
                      onBlur={e   => (e.target.style.borderColor = T.border)}
                    />
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 6, textAlign: "center" }}>
                      Sent via HealthPay SMS · Valid for 1 hour
                    </div>
                  </div>

                  {error && (
                    <div style={{ background: T.redL, color: T.red, fontSize: 13,
                      padding: "10px 14px", borderRadius: 8 }}>⚠️ {error}</div>
                  )}

                  <Btn full loading={loading} onClick={verifyOtp}>
                    Verify & Sign In →
                  </Btn>

                  <button onClick={() => { setStep("info"); setError(""); setOtp(""); }}
                    style={{ background: "none", border: "none", cursor: "pointer",
                      color: T.teal, fontWeight: 600, fontSize: 13, fontFamily: "inherit", padding: 0 }}>
                    ← Change number
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div style={{ padding: "12px 24px", borderTop: `1px solid ${T.border}`, textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 11, color: T.muted }}>
              🔒 Payments powered by HealthPay · CBE Licensed ·{" "}
              <a href="#" style={{ color: T.teal }}>Privacy Policy</a>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
