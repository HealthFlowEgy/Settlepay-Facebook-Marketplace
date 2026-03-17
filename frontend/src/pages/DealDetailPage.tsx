import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  T, Card, Badge, Btn, Spinner, Toast, Modal,
  fmt, timeAgo, Timeline,
} from "../components/ui";
import { dealsApi, disputesApi } from "../api";

// ─── Top-Up Modal ─────────────────────────────────────────────────────────────
function TopupModal({ deal, onClose, onDone }: any) {
  const [iframeUrl, setUrl]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dealsApi.getTopupUrl(deal.amount)
      .then(r => setUrl(r.data.iframeUrl))
      .catch(() => setUrl(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Modal onClose={onClose} title="Top Up Your Wallet" width={560}>
      <div style={{ padding: "8px 24px 24px" }}>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: T.muted }}>
          You need {fmt(deal.amount)} to secure this deal. Top up your SettePay wallet to continue.
        </p>
        {loading
          ? <Spinner />
          : iframeUrl
            ? <iframe src={iframeUrl} width="100%" height="480"
                style={{ border: "none", borderRadius: 12 }} title="HealthPay Top-Up" />
            : <div style={{ color: T.red, fontSize: 14 }}>Failed to load top-up. Please try again.</div>
        }
        <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
          <Btn onClick={onDone}>I've Topped Up → Continue</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── Dispute Modal ────────────────────────────────────────────────────────────
function DisputeModal({ dealId, onClose, onRaised }: any) {
  const [evidence, setEvidence] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  async function raise() {
    setLoading(true); setError("");
    try {
      await disputesApi.raise(dealId);
      if (evidence) {
        const dispute = await disputesApi.get(dealId); // rough — in prod use returned id
        await disputesApi.submitEvidence(dispute.data.id, [evidence]);
      }
      onRaised();
    } catch (e: any) {
      setError(e.response?.data?.message || "Failed to raise dispute");
    } finally { setLoading(false); }
  }

  return (
    <Modal onClose={onClose} title="Raise a Dispute" width={460}>
      <div style={{ padding: "12px 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ background: T.orangeL, borderRadius: 10, padding: "12px 16px", fontSize: 13, color: T.orange }}>
          ⚠️ A dispute will hold your payment. Admin will review evidence from both parties within 72 hours.
        </div>
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: T.muted, display: "block", marginBottom: 6 }}>
            Evidence URL (optional — photo, screenshot)
          </label>
          <input value={evidence} onChange={e => setEvidence(e.target.value)}
            placeholder="https://..." style={{ width: "100%", padding: "10px 12px",
              borderRadius: 8, border: `1.5px solid ${T.border}`, fontSize: 14, fontFamily: "inherit" }} />
          <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>
            Upload your evidence to any image host and paste the URL here
          </div>
        </div>
        {error && <div style={{ color: T.red, fontSize: 13 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="danger" loading={loading} onClick={raise}>Confirm Dispute</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── Deal Detail Page ─────────────────────────────────────────────────────────
export default function DealDetailPage({ dealId, userId, isProvider, onBack }: {
  dealId: string; userId: string; isProvider: boolean; onBack: () => void;
}) {
  const [deal, setDeal]         = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [acting, setActing]     = useState(false);
  const [toast, setToast]       = useState<any>(null);
  const [showTopup, setShowTopup]   = useState(false);
  const [showDispute, setShowDispute] = useState(false);

  const load = async () => {
    try { const r = await dealsApi.get(dealId); setDeal(r.data); }
    catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [dealId]);

  const act = async (fn: () => Promise<any>, successMsg: string, errorPrefix = "") => {
    setActing(true);
    try {
      await fn();
      await load();
      setToast({ msg: successMsg, type: "success" });
    } catch (e: any) {
      setToast({ msg: errorPrefix + (e.response?.data?.message || "Action failed"), type: "error" });
    } finally { setActing(false); }
  };

  if (loading) return <Spinner />;
  if (!deal)   return <div style={{ padding: 32, color: T.red }}>Deal not found</div>;

  const isSeller = deal.sellerId === userId;
  const isBuyer  = deal.buyerId  === userId;
  const sm       = { icon: "📋", label: deal.status };

  return (
    <div style={{ padding: 32, maxWidth: 680, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Back */}
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer",
        color: T.teal, fontWeight: 700, fontSize: 14, padding: 0, fontFamily: "inherit" }}>
        ← Back to Deals
      </button>

      {/* Hero card */}
      <Card style={{ overflow: "hidden" }}>
        <div style={{ padding: "24px 28px",
          background: `linear-gradient(135deg, ${T.tealL} 0%, ${T.white} 100%)` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <Badge status={deal.status} />
              <div style={{ fontSize: 22, fontWeight: 800, color: T.dark, marginTop: 10 }}>
                {deal.itemDescription}
              </div>
              <div style={{ fontSize: 34, fontWeight: 900, color: T.teal, marginTop: 6 }}>
                {fmt(deal.amount)}
              </div>
              {deal.commission && (
                <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>
                  Commission: {fmt(deal.commission)} · Seller receives: {fmt(deal.netPayout)}
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: T.muted, textAlign: "right" }}>
              <div>Deal #{deal.id.slice(0, 8).toUpperCase()}</div>
              <div>{timeAgo(deal.createdAt)}</div>
              {deal.waybillId && <div style={{ marginTop: 4 }}>📦 {deal.waybillId}</div>}
            </div>
          </div>
        </div>

        {/* Parties */}
        <div style={{ padding: "16px 28px", borderTop: `1px solid ${T.border}`,
          display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>SELLER</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.dark, marginTop: 2 }}>
              {deal.seller?.firstName} {deal.seller?.lastName}
              {isSeller && <span style={{ color: T.teal, fontSize: 11 }}> (You)</span>}
            </div>
          </div>
          <div style={{ color: T.muted, fontSize: 18 }}>→</div>
          <div>
            <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>BUYER</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.dark, marginTop: 2 }}>
              {deal.buyer?.firstName} {deal.buyer?.lastName}
              {isBuyer && <span style={{ color: T.teal, fontSize: 11 }}> (You)</span>}
            </div>
          </div>
        </div>
      </Card>

      {/* Action panel */}
      <Card style={{ padding: 22 }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: T.dark }}>
          Actions
        </h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {/* Seller: request payment */}
          {isSeller && deal.status === "PENDING" && (
            <Btn loading={acting}
              onClick={() => act(() => dealsApi.requestPayment(deal.id), "Payment request sent to buyer!")}>
              💳 Request Payment from Buyer
            </Btn>
          )}
          {/* Buyer: confirm or top up */}
          {isBuyer && deal.status === "AWAITING_BUYER_CONFIRMATION" && (
            <>
              <Btn loading={acting}
                onClick={() => act(() => dealsApi.confirmPayment(deal.id), "Payment secured in escrow! Seller will now ship.")}>
                ✅ Confirm & Pay {fmt(deal.amount)}
              </Btn>
              <Btn variant="ghost" onClick={() => setShowTopup(true)}>Top Up Wallet First</Btn>
            </>
          )}
          {/* Buyer: top-up flow */}
          {isBuyer && deal.status === "AWAITING_TOP_UP" && (
            <Btn loading={acting} onClick={() => setShowTopup(true)}>
              💰 Top Up & Continue
            </Btn>
          )}
          {/* Seller: mark shipped */}
          {isSeller && deal.status === "ESCROW_ACTIVE" && (
            <Btn loading={acting}
              onClick={async () => {
                const waybill = prompt("Enter waybill ID (optional):");
                await act(() => dealsApi.markShipped(deal.id, waybill || undefined), "Marked as shipped! Buyer will be notified.");
              }}>
              📦 Mark as Shipped
            </Btn>
          )}
          {/* Buyer: raise dispute */}
          {isBuyer && deal.status === "DELIVERY_CONFIRMED" && !deal.dispute && (
            <Btn variant="danger" onClick={() => setShowDispute(true)}>
              ⚠️ Raise Dispute
            </Btn>
          )}
          {/* Refresh */}
          <Btn variant="ghost" loading={acting} onClick={load}>↻ Refresh</Btn>
        </div>

        {/* Status explanation */}
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: T.grey, fontSize: 13, color: T.muted }}>
          {deal.status === "PENDING"                     && "Waiting for seller to send a payment request to the buyer."}
          {deal.status === "AWAITING_BUYER_CONFIRMATION" && "Payment request sent. Buyer must confirm to secure funds in escrow."}
          {deal.status === "AWAITING_TOP_UP"             && "Buyer's wallet has insufficient funds. Buyer needs to top up to proceed."}
          {deal.status === "ESCROW_ACTIVE"               && "Funds are secured in escrow. Seller should ship the item now."}
          {deal.status === "SHIPPED"                     && "Item shipped. Waiting for delivery confirmation via courier."}
          {deal.status === "DELIVERY_CONFIRMED"          && "Delivery confirmed. Buyer has 48 hours to raise a dispute if needed."}
          {deal.status === "SETTLED"                     && "Deal complete. Funds released to seller."}
          {deal.status === "DISPUTED"                    && "Dispute in progress. Admin will review and resolve within 72 hours."}
          {deal.status === "CANCELLED"                   && `Deal cancelled. Reason: ${deal.cancelReason || "N/A"}`}
          {deal.status === "PAYOUT_FAILED"               && "⚠️ Payout to seller failed. Operations team is investigating."}
        </div>
      </Card>

      {/* Timeline */}
      <Card style={{ padding: 22 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: T.dark }}>
          Deal Timeline
        </h3>
        <Timeline steps={[
          { label: "Deal Created",          date: deal.createdAt,         done: true },
          { label: "Buyer Confirmed",        date: deal.buyerConfirmedAt,  done: !!deal.buyerConfirmedAt },
          { label: "Escrow Activated",       date: deal.escrowActivatedAt, done: !!deal.escrowActivatedAt },
          { label: "Item Shipped",           date: deal.shippedAt,         done: !!deal.shippedAt },
          { label: "Delivery Confirmed",     date: deal.deliveredAt,       done: !!deal.deliveredAt },
          { label: "Funds Released",         date: deal.settledAt,         done: !!deal.settledAt },
        ]} />
      </Card>

      {/* Dispute section */}
      {deal.dispute && (
        <Card style={{ padding: 22, borderLeft: `4px solid ${T.red}` }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: T.red }}>
            ⚠️ Dispute
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <Badge text={deal.dispute.status.replace("_", " ")} color={T.red} bg={T.redL} />
              {deal.dispute.resolution && (
                <Badge text={deal.dispute.resolution.replace(/_/g, " ")} color={T.green} bg={T.greenL} />
              )}
            </div>
            {deal.dispute.evidenceDeadline && deal.dispute.status !== "RESOLVED" && (
              <div style={{ fontSize: 13, color: T.muted }}>
                Evidence deadline: <strong>{new Date(deal.dispute.evidenceDeadline).toLocaleString("en-EG")}</strong>
              </div>
            )}
            {deal.dispute.resolutionDeadline && deal.dispute.status !== "RESOLVED" && (
              <div style={{ fontSize: 13, color: T.muted }}>
                Resolution deadline: <strong>{new Date(deal.dispute.resolutionDeadline).toLocaleString("en-EG")}</strong>
              </div>
            )}
            {deal.dispute.adminNotes && (
              <div style={{ fontSize: 13, background: T.greenL, padding: "10px 14px", borderRadius: 8, color: T.green }}>
                📋 Admin notes: {deal.dispute.adminNotes}
              </div>
            )}
            {/* Evidence submission */}
            {deal.dispute.status === "EVIDENCE_COLLECTION" && (
              <div>
                <div style={{ fontSize: 13, color: T.muted, marginBottom: 8 }}>
                  Submit your evidence (photo or screenshot URL):
                </div>
                <EvidenceSubmitter disputeId={deal.dispute.id}
                  onSubmitted={() => { load(); setToast({ msg: "Evidence submitted!", type: "success" }); }} />
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showTopup && (
          <TopupModal deal={deal} onClose={() => setShowTopup(false)}
            onDone={() => { setShowTopup(false); load(); }} />
        )}
        {showDispute && (
          <DisputeModal dealId={deal.id} onClose={() => setShowDispute(false)}
            onRaised={() => {
              setShowDispute(false); load();
              setToast({ msg: "Dispute raised. Admin will review within 72h.", type: "warning" });
            }} />
        )}
        {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </AnimatePresence>
    </div>
  );
}

function EvidenceSubmitter({ disputeId, onSubmitted }: { disputeId: string; onSubmitted: () => void }) {
  const [url, setUrl]     = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!url) return;
    setLoading(true);
    try { await disputesApi.submitEvidence(disputeId, [url]); setUrl(""); onSubmitted(); }
    catch {} finally { setLoading(false); }
  }

  return (
    <div style={{ display: "flex", gap: 10 }}>
      <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://evidence-url.com/photo.jpg"
        style={{ flex: 1, padding: "10px 12px", borderRadius: 8,
          border: `1.5px solid ${T.border}`, fontSize: 14, fontFamily: "inherit" }} />
      <Btn small loading={loading} onClick={submit}>Submit</Btn>
    </div>
  );
}
