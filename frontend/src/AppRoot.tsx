import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  T, Card, Badge, Btn, Spinner, EmptyState, Toast, Modal,
  StatCard, SectionHeader, PageLayout, DealRow, Timeline,
  fmt, timeAgo,
} from "./components/ui";
import { useAuthStore } from "./store/auth.store";
import { dealsApi } from "./api";
import LoginPage from "./pages/LoginPage";
import DealDetailPage from "./pages/DealDetailPage";
import AdminPage from "./pages/AdminPage";

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function NavItem({ n, active, onClick }: { n: any; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10,
      width: "100%", padding: "10px 12px", borderRadius: 9,
      background: active ? "rgba(0,151,167,.15)" : "transparent",
      color: active ? T.teal : "#64748B",
      border: "none", cursor: "pointer", fontSize: 14,
      fontWeight: active ? 700 : 500, textAlign: "left",
      fontFamily: "inherit", marginBottom: 2,
      borderLeft: active ? `3px solid ${T.teal}` : "3px solid transparent",
    }}>
      <span style={{ fontSize: 16 }}>{n.icon}</span>{n.label}
    </button>
  );
}

function Sidebar({ user, page, setPage }: { user: any; page: string; setPage: (p: string) => void }) {
  const { clear } = useAuthStore();
  const nav = user?.isProvider
    ? [{ id: "dashboard", icon: "⚡", label: "Dashboard" }, { id: "deals", icon: "📋", label: "My Deals" },
       { id: "wallet",    icon: "💰", label: "Wallet"    }, { id: "profile", icon: "👤", label: "Profile" }]
    : [{ id: "dashboard", icon: "⚡", label: "Dashboard" }, { id: "deals", icon: "🛒", label: "My Orders" },
       { id: "wallet",    icon: "💰", label: "Wallet"    }, { id: "profile", icon: "👤", label: "Profile" }];

  return (
    <div style={{ width: 240, minHeight: "100vh", background: T.navy, display: "flex",
      flexDirection: "column", padding: "24px 0", flexShrink: 0 }}>
      <div style={{ padding: "0 20px 24px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
        <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.5, color: T.white }}>
          Sette<span style={{ color: T.teal }}>Pay</span>
        </div>
        <div style={{ fontSize: 10, color: "#475569", marginTop: 2, letterSpacing: 2, textTransform: "uppercase" }}>Marketplace</div>
      </div>
      <div style={{ flex: 1, padding: "12px 10px" }}>
        <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", padding: "8px 10px 6px" }}>Main</div>
        {nav.map(n => <NavItem key={n.id} n={n} active={page === n.id} onClick={() => setPage(n.id)} />)}
        <div style={{ fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", padding: "16px 10px 6px" }}>Admin</div>
        <NavItem n={{ id: "admin", icon: "🛡", label: "Admin Portal" }} active={page === "admin"} onClick={() => setPage("admin")} />
      </div>
      <div style={{ padding: "16px 18px", borderTop: "1px solid rgba(255,255,255,.07)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(0,151,167,.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 800, color: T.teal }}>
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.white }}>{user?.firstName} {user?.lastName}</div>
            <div style={{ fontSize: 10, color: "#475569" }}>{user?.isProvider ? "🏪 Seller" : "🛒 Buyer"} · {user?.kycTier}</div>
          </div>
        </div>
        <button onClick={clear} style={{ fontSize: 12, color: "#475569", background: "none",
          border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>Sign out →</button>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashboardPage({ user, setPage, onSelectDeal }: any) {
  const [deals, setDeals]     = useState<any[]>([]);
  const [balance, setBalance] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([dealsApi.list(user.isProvider ? "seller" : "buyer"), dealsApi.getBalance()])
      .then(([d, b]) => { setDeals(d.data.slice(0, 6)); setBalance(b.data); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  return (
    <PageLayout title={`Welcome, ${user.firstName} 👋`}
      subtitle={`${user.isProvider ? "Seller" : "Buyer"} Dashboard · ${new Date().toLocaleDateString("en-EG", { weekday: "long", month: "long", day: "numeric" })}`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
        <StatCard label="Wallet Balance"  value={fmt(balance?.total || 0)}                                    icon="💰" color={T.teal}  bg={T.tealL}  />
        <StatCard label="Active Escrows"  value={deals.filter(d => d.status === "ESCROW_ACTIVE").length}      icon="🔒" color={T.green} bg={T.greenL} />
        <StatCard label="Open Disputes"   value={deals.filter(d => d.status === "DISPUTED").length}           icon="⚠️" color={T.red}   bg={T.redL}   />
        <StatCard label="Total Deals"     value={deals.length}                                                 icon="📋" color={T.blue}  bg={T.blueL}  />
      </div>
      {user.isProvider && (
        <Card style={{ padding: 22, background: `linear-gradient(135deg, ${T.teal}, ${T.tealD})`, border: "none" }}>
          <div style={{ color: T.white }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>🔒 Start a Secure Escrow Deal</div>
            <div style={{ fontSize: 13, opacity: 0.8, margin: "6px 0 14px" }}>Share a payment link in any Messenger conversation</div>
            <Btn variant="secondary" small onClick={() => setPage("deals")} style={{ borderColor: T.white, color: T.white }}>Create Deal →</Btn>
          </div>
        </Card>
      )}
      <Card style={{ overflow: "hidden" }}>
        <SectionHeader title="Recent Activity" action={<Btn variant="ghost" small onClick={() => setPage("deals")}>See all</Btn>} />
        {deals.length === 0
          ? <EmptyState icon="📭" title="No deals yet" subtitle={user.isProvider ? "Create your first escrow deal" : "Start buying with protection"} />
          : deals.map(d => <DealRow key={d.id} deal={d} onClick={() => onSelectDeal(d.id)} />)
        }
      </Card>
    </PageLayout>
  );
}

// ─── Deals Page ───────────────────────────────────────────────────────────────
function DealsPage({ user, onSelectDeal }: any) {
  const [deals, setDeals]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState("ALL");
  const [showCreate, setCreate] = useState(false);
  const [toast, setToast]     = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try { const r = await dealsApi.list(user.isProvider ? "seller" : "buyer"); setDeals(r.data); }
    catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const FILTERS = ["ALL","ESCROW_ACTIVE","SHIPPED","DISPUTED","SETTLED","CANCELLED"];
  const filtered = filter === "ALL" ? deals : deals.filter(d => d.status === filter);

  return (
    <PageLayout title={user.isProvider ? "My Deals" : "My Orders"}
      action={user.isProvider && <Btn onClick={() => setCreate(true)}>+ New Deal</Btn>}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600,
            border: `1.5px solid ${filter === f ? T.teal : T.border}`,
            background: filter === f ? T.tealL : T.white,
            color: filter === f ? T.teal : T.muted, cursor: "pointer", fontFamily: "inherit",
          }}>{f === "ALL" ? "All" : f.replace(/_/g, " ")}</button>
        ))}
      </div>
      <Card style={{ overflow: "hidden" }}>
        {loading ? <Spinner />
          : filtered.length === 0
            ? <EmptyState icon="📭" title="No deals" subtitle="Your deals appear here" />
            : filtered.map(d => <DealRow key={d.id} deal={d} onClick={() => onSelectDeal(d.id)} />)
        }
      </Card>
      <AnimatePresence>
        {showCreate && <CreateDealModal onClose={() => setCreate(false)}
          onCreated={() => { setCreate(false); load(); setToast({ msg: "Deal created!", type: "success" }); }} />}
        {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </AnimatePresence>
    </PageLayout>
  );
}

function CreateDealModal({ onClose, onCreated }: any) {
  const [buyerId, setBuyer] = useState(""); const [amount, setAmount] = useState("");
  const [desc, setDesc]     = useState(""); const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  async function create() {
    if (!buyerId || !amount || !desc) { setError("All fields required"); return; }
    const amt = parseFloat(amount);
    if (amt < 50 || amt > 50000) { setError("Amount must be between EGP 50 and EGP 50,000"); return; }
    setLoading(true); setError("");
    try { await dealsApi.create({ buyerId, amount: amt, itemDescription: desc }); onCreated(); }
    catch (e: any) { setError(e.response?.data?.message || "Failed to create deal"); }
    finally { setLoading(false); }
  }

  return (
    <Modal onClose={onClose} title="New Escrow Deal" width={460}>
      <div style={{ padding: "16px 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ background: T.tealL, borderRadius: 10, padding: "12px 16px", fontSize: 13, color: T.teal }}>
          🔒 Funds held in escrow until delivery confirmed.
        </div>
        {[
          { label: "Buyer's SettePay ID *", val: buyerId, set: setBuyer, ph: "Buyer shares this from their profile" },
          { label: "Amount (EGP) *",        val: amount,  set: setAmount, ph: "e.g. 2500", type: "number" },
          { label: "Item Description *",    val: desc,    set: setDesc,   ph: "e.g. iPhone 14 Pro 256GB" },
        ].map(f => (
          <div key={f.label}>
            <label style={{ fontSize: 13, fontWeight: 600, color: T.muted, display: "block", marginBottom: 5 }}>{f.label}</label>
            <input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph} type={(f as any).type}
              style={{ width: "100%", padding: "11px 14px", borderRadius: 10,
                border: `1.5px solid ${T.border}`, fontSize: 14, fontFamily: "inherit" }} />
          </div>
        ))}
        {error && <div style={{ background: T.redL, color: T.red, fontSize: 13, padding: "10px 14px", borderRadius: 8 }}>⚠️ {error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <Btn loading={loading} onClick={create}>Create Escrow Deal</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── Wallet Page ──────────────────────────────────────────────────────────────
function WalletPage() {
  const [wallet, setWallet]   = useState<any>(null);
  const [topAmt, setTopAmt]   = useState("200");
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState<any>(null);

  useEffect(() => {
    dealsApi.getBalance().then(r => setWallet(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function openTopup() {
    try {
      const res = await dealsApi.getTopupUrl(parseFloat(topAmt));
      window.open(res.data.iframeUrl, "_blank", "width=520,height=600,scrollbars=yes");
      setToast({ msg: "Top-up window opened", type: "info" });
    } catch { setToast({ msg: "Failed to generate top-up URL", type: "error" }); }
  }

  if (loading) return <Spinner />;
  return (
    <PageLayout title="Wallet" subtitle="Your SettePay balance and transaction history">
      <Card style={{ padding: 28, background: `linear-gradient(135deg, ${T.teal}, ${T.tealD})`, border: "none" }}>
        <div style={{ color: "rgba(255,255,255,.65)", fontSize: 13, fontWeight: 600 }}>Available Balance</div>
        <div style={{ color: T.white, fontSize: 44, fontWeight: 900, marginTop: 8, letterSpacing: -1 }}>{fmt(wallet?.total || 0)}</div>
        <div style={{ color: "rgba(255,255,255,.5)", fontSize: 12, marginTop: 8 }}>SettePay Marketplace · Powered by HealthPay · CBE Licensed</div>
      </Card>
      <Card style={{ padding: 24 }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, color: T.dark }}>Top Up</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {["50","100","200","500","1000","2000"].map(a => (
            <button key={a} onClick={() => setTopAmt(a)} style={{
              padding: "8px 16px", borderRadius: 10, fontWeight: 700, fontSize: 14, fontFamily: "inherit",
              border: `2px solid ${topAmt === a ? T.teal : T.border}`,
              background: topAmt === a ? T.tealL : T.white, color: topAmt === a ? T.teal : T.muted, cursor: "pointer",
            }}>EGP {a}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
          <input value={topAmt} onChange={e => setTopAmt(e.target.value)} type="number" placeholder="Custom amount"
            style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${T.border}`, fontSize: 14, fontFamily: "inherit" }} />
          <Btn onClick={openTopup}>Top Up →</Btn>
        </div>
        <div style={{ fontSize: 12, color: T.muted }}>💳 Meeza &nbsp;·&nbsp; Visa / Mastercard &nbsp;·&nbsp; InstaPay</div>
      </Card>
      <Card style={{ overflow: "hidden" }}>
        <SectionHeader title="Transaction History" />
        {!wallet?.balance?.length
          ? <EmptyState icon="📊" title="No transactions yet" subtitle="Transactions appear here" />
          : wallet.balance.map((tx: any) => (
            <div key={tx.uid} style={{ padding: "14px 22px", display: "flex", justifyContent: "space-between",
              alignItems: "center", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ width: 36, height: 36, borderRadius: 10,
                  background: tx.type === "credit" ? T.greenL : T.redL,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                  {tx.type === "credit" ? "↓" : "↑"}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.dark, textTransform: "capitalize" }}>{tx.type}</div>
                  <div style={{ fontSize: 11, color: T.muted }}>{new Date(tx.createdAt).toLocaleString("en-EG")}</div>
                </div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 16, color: tx.type === "credit" ? T.green : T.red }}>
                {tx.type === "credit" ? "+" : "-"}{fmt(tx.amount)}
              </div>
            </div>
          ))
        }
      </Card>
      <AnimatePresence>
        {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </AnimatePresence>
    </PageLayout>
  );
}

// ─── Profile Page ─────────────────────────────────────────────────────────────
function ProfilePage({ user }: any) {
  const kycInfo: Record<string, any> = {
    TIER_0: { color: T.red,   label: "Unverified",   limits: "EGP 200/day · EGP 500/month" },
    TIER_1: { color: T.gold,  label: "ID Verified",  limits: "EGP 1,000/day · EGP 3,000/month" },
    TIER_2: { color: T.teal,  label: "Enhanced KYC", limits: "EGP 10,000/day · EGP 30,000/month" },
    TIER_3: { color: T.green, label: "Full KYC",     limits: "EGP 50,000/day · EGP 200,000/month" },
  };
  const kyc = kycInfo[user?.kycTier] || kycInfo.TIER_0;

  return (
    <PageLayout title="Profile" subtitle="Your account and verification status">
      <Card style={{ padding: 28 }}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: T.tealL, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, fontWeight: 800, color: T.teal }}>
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.dark }}>{user?.firstName} {user?.lastName}</div>
            <div style={{ fontSize: 14, color: T.muted, marginTop: 2 }}>{user?.mobile}</div>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Badge text={user?.isProvider ? "🏪 Seller" : "🛒 Buyer"} color={T.teal} bg={T.tealL} />
              <Badge text={`🛡 ${kyc.label}`} color={kyc.color} bg={kyc.color + "22"} />
            </div>
          </div>
        </div>
        <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {[
            { label: "KYC Status",         value: user?.kycStatus },
            { label: "Transaction Limits", value: kyc.limits },
            { label: "Account Type",       value: user?.isProvider ? "Seller (Provider)" : "Buyer (User)" },
            { label: "Member Since",       value: user?.createdAt ? new Date(user.createdAt).toLocaleDateString("en-EG") : "—" },
          ].map(f => (
            <div key={f.label} style={{ background: T.grey, borderRadius: 12, padding: "12px 16px" }}>
              <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>{f.label}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.dark, marginTop: 4 }}>{f.value}</div>
            </div>
          ))}
        </div>
      </Card>
      {user?.kycTier === "TIER_0" && (
        <Card style={{ padding: 24, borderLeft: `4px solid ${T.gold}` }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 800, color: T.gold }}>🛡 Verify Your Identity</h3>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: T.muted }}>
            Verify your National ID to unlock higher limits. Powered by Valify — takes under 3 minutes.
          </p>
          <Btn onClick={() => alert("KYC flow — National ID + selfie via Valify integration")}>Start Verification</Btn>
        </Card>
      )}
    </PageLayout>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function AppRoot() {
  const { user, token, setAuth, isAuthenticated } = useAuthStore();
  const [page, setPage]     = useState("dashboard");
  const [dealId, setDealId] = useState<string | null>(null);

  if (!isAuthenticated || !token) {
    return <LoginPage onLogin={(u: any, t: string) => setAuth(u, t)} />;
  }

  if (dealId) {
    return (
      <Layout user={user} page={page} setPage={p => { setPage(p); setDealId(null); }}>
        <DealDetailPage dealId={dealId} userId={user!.id} isProvider={user!.isProvider}
          onBack={() => setDealId(null)} />
      </Layout>
    );
  }

  const pages: Record<string, React.ReactNode> = {
    dashboard: <DashboardPage user={user} setPage={setPage} onSelectDeal={setDealId} />,
    deals:     <DealsPage     user={user} onSelectDeal={setDealId} />,
    wallet:    <WalletPage />,
    profile:   <ProfilePage   user={user} />,
    admin:     <AdminPage />,
  };

  return (
    <Layout user={user} page={page} setPage={setPage}>
      <AnimatePresence mode="wait">
        <motion.div key={page}
          initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          {pages[page] || pages.dashboard}
        </motion.div>
      </AnimatePresence>
    </Layout>
  );
}

function Layout({ user, page, setPage, children }: any) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F8FAFC",
      fontFamily: "'Inter', system-ui, sans-serif", color: T.dark }}>
      <Sidebar user={user} page={page} setPage={setPage} />
      <main style={{ flex: 1, overflowY: "auto" }}>{children}</main>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        body { margin: 0; }
        button, input, textarea, select { font-family: inherit; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
      `}</style>
    </div>
  );
}
