import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  T, Card, Badge, Btn, Spinner, EmptyState, Toast, Modal,
  StatCard, SectionHeader, PageLayout, DealRow, fmt, timeAgo, Select,
} from "../components/ui";
import { adminApi } from "../api";

// ─── Dispute Resolution Panel ─────────────────────────────────────────────────
function ResolveDisputeModal({ dispute, onClose, onResolved }: any) {
  const [resolution, setResolution] = useState("FULL_RELEASE");
  const [notes, setNotes]           = useState("");
  const [sellerPayout, setSeller]   = useState("");
  const [buyerRefund, setBuyer]     = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  const deal   = dispute.deal;
  const isPartial = resolution === "PARTIAL";

  async function resolve() {
    setLoading(true); setError("");
    try {
      await adminApi.resolveDispute(dispute.id, {
        resolution, adminNotes: notes,
        sellerPayout: isPartial ? parseFloat(sellerPayout) : undefined,
        buyerRefund:  isPartial ? parseFloat(buyerRefund)  : undefined,
      });
      onResolved();
    } catch (e: any) {
      setError(e.response?.data?.message || "Resolution failed");
    } finally { setLoading(false); }
  }

  return (
    <Modal onClose={onClose} title={`Resolve Dispute — Deal #${deal?.id?.slice(0, 8)}`} width={520}>
      <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Deal summary */}
        <div style={{ background: T.grey, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, color: T.muted, marginBottom: 4 }}>Disputed Deal</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: T.dark }}>{deal?.itemDescription}</div>
          <div style={{ fontSize: 14, color: T.muted, marginTop: 4 }}>
            {fmt(deal?.amount)} · {deal?.buyer?.firstName} → {deal?.seller?.firstName}
          </div>
        </div>

        {/* Evidence review */}
        {(dispute.buyerEvidence?.length > 0 || dispute.sellerEvidence?.length > 0) && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.muted, marginBottom: 8 }}>Evidence Submitted</div>
            {dispute.buyerEvidence?.map((url: string, i: number) => (
              <div key={i} style={{ fontSize: 12, color: T.blue, marginBottom: 4 }}>
                🟦 Buyer: <a href={url} target="_blank" rel="noreferrer" style={{ color: T.blue }}>{url}</a>
              </div>
            ))}
            {dispute.sellerEvidence?.map((url: string, i: number) => (
              <div key={i} style={{ fontSize: 12, color: T.green, marginBottom: 4 }}>
                🟩 Seller: <a href={url} target="_blank" rel="noreferrer" style={{ color: T.green }}>{url}</a>
              </div>
            ))}
          </div>
        )}

        {/* Resolution selector */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.muted, marginBottom: 10 }}>Resolution</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { id: "FULL_RELEASE", icon: "🟩", label: "Full Release to Seller", sub: `Seller gets ${fmt(deal?.amount * 0.982)} (1.8% commission deducted)` },
              { id: "PARTIAL",      icon: "🔶", label: "Partial — Split",        sub: "Enter custom amounts below" },
              { id: "FULL_REFUND",  icon: "🟦", label: "Full Refund to Buyer",   sub: `Buyer gets ${fmt(deal?.amount)} (full amount)` },
            ].map(r => (
              <div key={r.id} onClick={() => setResolution(r.id)}
                style={{
                  padding: "12px 16px", borderRadius: 12, cursor: "pointer",
                  border: `2px solid ${resolution === r.id ? T.teal : T.border}`,
                  background: resolution === r.id ? T.tealL : T.white,
                }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: T.dark }}>{r.icon} {r.label}</div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 3 }}>{r.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Partial amounts */}
        {isPartial && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 5 }}>
                Seller Payout (EGP)
              </label>
              <input value={sellerPayout} onChange={e => setSeller(e.target.value)} type="number"
                placeholder={`max ${deal?.amount}`}
                style={{ padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${T.border}`,
                  fontSize: 14, width: "100%", fontFamily: "inherit" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 5 }}>
                Buyer Refund (EGP)
              </label>
              <input value={buyerRefund} onChange={e => setBuyer(e.target.value)} type="number"
                placeholder={`max ${deal?.amount}`}
                style={{ padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${T.border}`,
                  fontSize: 14, width: "100%", fontFamily: "inherit" }} />
            </div>
            {sellerPayout && buyerRefund && (
              <div style={{ gridColumn: "1/-1", fontSize: 12, color: T.muted }}>
                Total: {fmt(parseFloat(sellerPayout || "0") + parseFloat(buyerRefund || "0"))}
                {" "}(Escrow: {fmt(deal?.amount)})
              </div>
            )}
          </div>
        )}

        {/* Admin notes */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: T.muted, display: "block", marginBottom: 5 }}>
            Admin Notes (optional)
          </label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Rationale for this decision..."
            rows={3}
            style={{ padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${T.border}`,
              fontSize: 14, width: "100%", fontFamily: "inherit", resize: "vertical" }} />
        </div>

        {error && <div style={{ color: T.red, fontSize: 13 }}>⚠️ {error}</div>}

        <div style={{ display: "flex", gap: 10, paddingTop: 8 }}>
          <Btn loading={loading} onClick={resolve}>Resolve Dispute</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── Disputes Tab ─────────────────────────────────────────────────────────────
function DisputesTab() {
  const [disputes, setDisputes] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState("OPEN");
  const [selected, setSelected] = useState<any>(null);
  const [toast, setToast]       = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminApi.disputes(filter === "ALL" ? undefined : filter);
      setDisputes(res.data);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [filter]);

  const FILTERS = ["ALL","OPEN","EVIDENCE_COLLECTION","UNDER_REVIEW","RESOLVED"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600,
              border: `1.5px solid ${filter === f ? T.teal : T.border}`,
              background: filter === f ? T.tealL : T.white,
              color: filter === f ? T.teal : T.muted,
              cursor: "pointer", fontFamily: "inherit",
            }}>{f === "ALL" ? "All" : f.replace("_", " ")}</button>
        ))}
      </div>

      <Card style={{ overflow: "hidden" }}>
        <SectionHeader title={`Disputes ${loading ? "" : `(${disputes.length})`}`} />
        {loading ? <Spinner />
          : disputes.length === 0
            ? <EmptyState icon="⚖️" title="No disputes found" subtitle="Disputes appear here when buyers raise them" />
            : disputes.map(d => (
              <motion.div key={d.id} whileHover={{ background: "#F8FAFC" }}
                style={{ padding: "16px 22px", borderBottom: `1px solid ${T.border}`,
                  display: "flex", gap: 16, alignItems: "flex-start" }}>
                {/* Status indicator */}
                <div style={{ width: 42, height: 42, borderRadius: 11, flexShrink: 0,
                  background: d.status === "RESOLVED" ? T.greenL : T.redL,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
                  {d.status === "RESOLVED" ? "✅" : "⚠️"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: T.dark }}>
                    {d.deal?.itemDescription}
                  </div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 3 }}>
                    {fmt(d.deal?.amount)} · Buyer: {d.deal?.buyer?.firstName} {d.deal?.buyer?.lastName}
                    &nbsp;→ Seller: {d.deal?.seller?.firstName} {d.deal?.seller?.lastName}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                    Raised: {timeAgo(d.createdAt)}
                    {d.resolutionDeadline && d.status !== "RESOLVED" && (
                      <span style={{ color: new Date(d.resolutionDeadline) < new Date() ? T.red : T.muted }}>
                        {" "}· Deadline: {new Date(d.resolutionDeadline).toLocaleString("en-EG")}
                      </span>
                    )}
                  </div>
                  {d.resolution && (
                    <div style={{ marginTop: 4 }}>
                      <Badge text={d.resolution.replace(/_/g, " ")}
                        color={d.resolution === "FULL_REFUND" ? T.blue : T.green}
                        bg={d.resolution === "FULL_REFUND" ? T.blueL : T.greenL} />
                    </div>
                  )}
                </div>
                <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                  <Badge text={d.status.replace("_", " ")}
                    color={d.status === "RESOLVED" ? T.green : T.red}
                    bg={d.status === "RESOLVED" ? T.greenL : T.redL} />
                  {d.status !== "RESOLVED" && (
                    <Btn small onClick={() => setSelected(d)}>Resolve</Btn>
                  )}
                </div>
              </motion.div>
            ))
        }
      </Card>

      <AnimatePresence>
        {selected && (
          <ResolveDisputeModal dispute={selected} onClose={() => setSelected(null)}
            onResolved={() => {
              setSelected(null);
              load();
              setToast({ msg: "Dispute resolved successfully", type: "success" });
            }} />
        )}
        {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </AnimatePresence>
    </div>
  );
}

// ─── Deals Tab ────────────────────────────────────────────────────────────────
function DealsTab() {
  const [deals, setDeals]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");

  const FILTERS = ["ALL","ESCROW_ACTIVE","SHIPPED","DISPUTED","PAYOUT_FAILED","SETTLED"];

  useEffect(() => {
    setLoading(true);
    adminApi.deals(filter === "ALL" ? undefined : filter)
      .then(r => setDeals(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600,
              border: `1.5px solid ${filter === f ? T.teal : T.border}`,
              background: filter === f ? T.tealL : T.white,
              color: filter === f ? T.teal : T.muted,
              cursor: "pointer", fontFamily: "inherit",
            }}>{f === "ALL" ? "All Deals" : f.replace("_", " ")}</button>
        ))}
      </div>
      <Card style={{ overflow: "hidden" }}>
        <SectionHeader title={`Deals ${loading ? "" : `(${deals.length})`}`} />
        {loading ? <Spinner />
          : deals.length === 0
            ? <EmptyState icon="📋" title="No deals" subtitle="Deals appear here" />
            : deals.map(d => <DealRow key={d.id} deal={d} />)
        }
      </Card>
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState<any>(null);

  useEffect(() => {
    adminApi.users().then(r => setUsers(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function block(userId: string) {
    const reason = prompt("Reason for blocking:");
    if (!reason) return;
    try {
      await adminApi.blockUser(userId, reason);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, isBlocked: true } : u));
      setToast({ msg: "User blocked", type: "success" });
    } catch { setToast({ msg: "Failed to block user", type: "error" }); }
  }

  const KYC_COLOR: any = { TIER_0: T.red, TIER_1: T.gold, TIER_2: T.teal, TIER_3: T.green };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card style={{ overflow: "hidden" }}>
        <SectionHeader title={`Users ${loading ? "" : `(${users.length})`}`} />
        {loading ? <Spinner />
          : users.map((u, i) => (
            <div key={u.id} style={{ padding: "14px 22px", display: "flex", alignItems: "center",
              gap: 14, borderBottom: `1px solid ${T.border}`,
              background: u.isBlocked ? T.redL : "transparent" }}>
              {/* Avatar */}
              <div style={{ width: 38, height: 38, borderRadius: 10, background: T.tealL,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 700, color: T.teal, flexShrink: 0 }}>
                {u.firstName?.[0]}{u.lastName?.[0]}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: T.dark }}>
                  {u.firstName} {u.lastName}
                  {u.isBlocked && <span style={{ marginLeft: 8, color: T.red, fontSize: 11 }}>⛔ BLOCKED</span>}
                </div>
                <div style={{ fontSize: 12, color: T.muted }}>
                  {u.mobile} · {u.isProvider ? "🏪 Seller" : "🛒 Buyer"}
                  &nbsp;· {u._count?.dealsAsSeller || 0} sales, {u._count?.dealsAsBuyer || 0} purchases
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                <Badge text={u.kycTier} color={KYC_COLOR[u.kycTier] || T.muted}
                  bg={(KYC_COLOR[u.kycTier] || T.muted) + "22"} />
                {!u.isBlocked && (
                  <Btn small variant="danger" onClick={() => block(u.id)}>Block</Btn>
                )}
              </div>
            </div>
          ))
        }
      </Card>
      <AnimatePresence>
        {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </AnimatePresence>
    </div>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────────
function AuditTab() {
  const [logs, setLogs]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.audit().then(r => setLogs(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const opColors: Record<string, string> = {
    deductFromUser: T.red,
    payToUser:      T.green,
    authUser:       T.blue,
    logoutUser:     T.muted,
    str_filed:      T.orange,
    raiseDispute:   T.purple,
  };

  return (
    <Card style={{ overflow: "hidden" }}>
      <SectionHeader title={`Audit Log (last 100)`} />
      {loading ? <Spinner />
        : logs.length === 0
          ? <EmptyState icon="📄" title="No audit logs" subtitle="API calls are logged here" />
          : logs.map(l => (
            <div key={l.id} style={{ padding: "12px 22px", borderBottom: `1px solid ${T.border}`,
              display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 5,
                background: l.responseSuccess ? T.green : T.red }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: opColors[l.operation] || T.dark }}>
                    {l.operation}
                  </span>
                  {l.responseCode && (
                    <Badge text={l.responseCode}
                      color={l.responseSuccess ? T.green : T.red}
                      bg={l.responseSuccess ? T.greenL : T.redL} />
                  )}
                </div>
                {l.errorMessage && (
                  <div style={{ fontSize: 11, color: T.red, marginTop: 2 }}>{l.errorMessage}</div>
                )}
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                  {timeAgo(l.createdAt)}
                  {l.userId && ` · User: ${l.userId.slice(0, 8)}...`}
                  {l.dealId && ` · Deal: ${l.dealId.slice(0, 8)}...`}
                </div>
              </div>
            </div>
          ))
      }
    </Card>
  );
}

// ─── Admin Page ───────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [tab, setTab]     = useState("overview");
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    adminApi.stats().then(r => setStats(r.data)).catch(() => {});
  }, []);

  const TABS = [
    { id: "overview",  label: "⚡ Overview" },
    { id: "disputes",  label: "⚠️ Disputes" },
    { id: "deals",     label: "📋 Deals" },
    { id: "users",     label: "👥 Users" },
    { id: "audit",     label: "📄 Audit Log" },
  ];

  return (
    <PageLayout
      title="Admin Portal"
      subtitle="SettePay Marketplace Operations Dashboard"
    >
      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, background: T.grey, padding: 4,
        borderRadius: 12, width: "fit-content" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: "8px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600,
              border: "none", cursor: "pointer", fontFamily: "inherit",
              background: tab === t.id ? T.white : "transparent",
              color: tab === t.id ? T.dark : T.muted,
              boxShadow: tab === t.id ? "0 1px 4px rgba(0,0,0,.08)" : "none",
            }}>{t.label}</button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>

          {tab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                <StatCard label="Total Deals"      value={stats?.total || "—"}    icon="📋" color={T.blue}   bg={T.blueL} />
                <StatCard label="Active Escrows"   value={stats?.active || "—"}   icon="🔒" color={T.teal}   bg={T.tealL} />
                <StatCard label="Open Disputes"    value={stats?.disputed || "—"} icon="⚠️" color={T.red}    bg={T.redL} />
                <StatCard label="Settled Deals"    value={stats?.settled || "—"}  icon="✅" color={T.green}  bg={T.greenL} />
                <StatCard label="Total Commission" value={stats?.totalCommission ? fmt(stats.totalCommission) : "—"}
                  icon="💰" color={T.gold} bg={T.goldL} />
              </div>

              {/* Quick actions */}
              <Card style={{ padding: 24 }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: T.dark }}>
                  ⚡ Quick Actions
                </h3>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Btn variant="secondary" small onClick={() => setTab("disputes")}>
                    View Open Disputes
                  </Btn>
                  <Btn variant="ghost" small onClick={() => setTab("deals")}>
                    Failed Payouts
                  </Btn>
                  <Btn variant="ghost" small onClick={() => setTab("audit")}>
                    Audit Log
                  </Btn>
                </div>
              </Card>

              {/* Health indicators */}
              <Card style={{ padding: 24 }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: T.dark }}>
                  🏥 System Health
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { label: "HealthPay API", status: "operational", icon: "🟢" },
                    { label: "Bosta Webhooks", status: "operational", icon: "🟢" },
                    { label: "Messenger Bot", status: "operational", icon: "🟢" },
                    { label: "SMS Gateway", status: "operational", icon: "🟢" },
                    { label: "KYC (Valify)", status: "operational", icon: "🟢" },
                  ].map(s => (
                    <div key={s.label} style={{ display: "flex", justifyContent: "space-between",
                      padding: "10px 14px", background: T.grey, borderRadius: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: T.dark }}>{s.label}</span>
                      <span style={{ fontSize: 13 }}>{s.icon} {s.status}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {tab === "disputes" && <DisputesTab />}
          {tab === "deals"    && <DealsTab />}
          {tab === "users"    && <UsersTab />}
          {tab === "audit"    && <AuditTab />}
        </motion.div>
      </AnimatePresence>
    </PageLayout>
  );
}
