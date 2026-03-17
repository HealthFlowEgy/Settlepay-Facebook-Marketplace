import { motion } from "framer-motion";
import { useState, useEffect, ReactNode } from "react";

export const T = {
  navy:    "#0D1B2A",
  teal:    "#0097A7",
  tealL:   "#E0F7FA",
  tealD:   "#006978",
  gold:    "#B8860B",
  goldL:   "#FEF9E7",
  green:   "#1A8A45",
  greenL:  "#E8F8F0",
  red:     "#C0392B",
  redL:    "#FDEDEC",
  blue:    "#1877F2",
  blueL:   "#E7F0FD",
  purple:  "#7B2FBE",
  purpleL: "#F3E8FF",
  orange:  "#D4700A",
  orangeL: "#FEF5E7",
  grey:    "#F0F4F8",
  muted:   "#64748B",
  white:   "#FFFFFF",
  dark:    "#0F172A",
  border:  "#E2E8F0",
};

export const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  PENDING:                     { label: "Pending",           color: T.muted,   bg: T.grey,    icon: "⏳" },
  AWAITING_BUYER_CONFIRMATION: { label: "Awaiting Payment",  color: T.gold,    bg: T.goldL,   icon: "💳" },
  AWAITING_TOP_UP:             { label: "Top-Up Required",   color: T.blue,    bg: T.blueL,   icon: "💰" },
  ESCROW_DEDUCTING:            { label: "Processing...",     color: T.teal,    bg: T.tealL,   icon: "⚙️" },
  ESCROW_ACTIVE:               { label: "Funds Secured",     color: T.teal,    bg: T.tealL,   icon: "🔒" },
  SHIPPED:                     { label: "Shipped",           color: T.purple,  bg: T.purpleL, icon: "📦" },
  DELIVERY_CONFIRMED:          { label: "Delivered",         color: T.green,   bg: T.greenL,  icon: "✅" },
  SETTLING:                    { label: "Releasing...",      color: T.teal,    bg: T.tealL,   icon: "⚡" },
  SETTLED:                     { label: "Settled",           color: T.green,   bg: T.greenL,  icon: "💸" },
  DISPUTED:                    { label: "Disputed",          color: T.red,     bg: T.redL,    icon: "⚠️" },
  REFUNDING:                   { label: "Refunding...",      color: T.gold,    bg: T.goldL,   icon: "↩️" },
  REFUNDED:                    { label: "Refunded",          color: T.blue,    bg: T.blueL,   icon: "↩️" },
  PAYOUT_FAILED:               { label: "Payout Failed",     color: T.red,     bg: T.redL,    icon: "❌" },
  PAYMENT_ERROR:               { label: "Payment Error",     color: T.red,     bg: T.redL,    icon: "❌" },
  CANCELLED:                   { label: "Cancelled",         color: T.muted,   bg: T.grey,    icon: "✕" },
};

export const fmt     = (n: number)  => `EGP ${(n || 0).toLocaleString("en-EG", { minimumFractionDigits: 2 })}`;
export const timeAgo = (d: string)  => {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// ── Badge ─────────────────────────────────────────────────────────────────────
export function Badge({ status, text, color, bg }: { status?: string; text?: string; color?: string; bg?: string }) {
  const m = status ? (STATUS_META[status] || { label: status, color: T.muted, bg: T.grey, icon: "•" }) : null;
  const c = color || m?.color || T.muted;
  const b = bg    || m?.bg    || T.grey;
  return (
    <span style={{
      background: b, color: c,
      padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600,
      border: `1px solid ${c}22`, display: "inline-flex", alignItems: "center", gap: 4,
      whiteSpace: "nowrap",
    }}>
      {m ? `${m.icon} ${m.label}` : text}
    </span>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────
type BtnVariant = "primary" | "secondary" | "danger" | "ghost" | "link";
export function Btn({
  children, onClick, variant = "primary", disabled = false,
  small = false, loading = false, full = false, style: extraStyle,
}: {
  children: ReactNode; onClick?: () => void; variant?: BtnVariant;
  disabled?: boolean; small?: boolean; loading?: boolean;
  full?: boolean; style?: React.CSSProperties;
}) {
  const variants: Record<BtnVariant, React.CSSProperties> = {
    primary:   { background: T.teal,   color: T.white,       border: "none" },
    secondary: { background: "transparent", color: T.teal,   border: `2px solid ${T.teal}` },
    danger:    { background: T.red,    color: T.white,       border: "none" },
    ghost:     { background: T.grey,   color: T.dark,        border: "none" },
    link:      { background: "none",   color: T.teal,        border: "none", padding: 0, textDecoration: "underline" },
  };
  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.97 }}
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        ...variants[variant],
        padding: small ? "6px 14px" : "11px 22px",
        borderRadius: 10, fontWeight: 700,
        fontSize: small ? 13 : 15,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex", alignItems: "center", gap: 6,
        fontFamily: "inherit", width: full ? "100%" : undefined,
        justifyContent: full ? "center" : undefined,
        ...(extraStyle || {}),
      }}
    >
      {loading
        ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
            style={{ display: "inline-block" }}>⟳</motion.span>
        : children}
    </motion.button>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, style, onClick }: { children: ReactNode; style?: React.CSSProperties; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{
      background: T.white, borderRadius: 16,
      boxShadow: "0 1px 3px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.04)",
      border: `1px solid ${T.border}`,
      cursor: onClick ? "pointer" : undefined,
      ...style,
    }}>{children}</div>
  );
}

// ── Input ─────────────────────────────────────────────────────────────────────
export function Input({ label, hint, error, ...props }: any) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {label && <label style={{ fontSize: 13, fontWeight: 600, color: T.muted }}>{label}</label>}
      <input
        style={{
          padding: "11px 14px", borderRadius: 10, fontSize: 15,
          border: `1.5px solid ${error ? T.red : T.border}`, outline: "none",
          fontFamily: "inherit", color: T.dark, background: T.white,
          transition: "border-color .15s", width: "100%",
        }}
        onFocus={e  => !error && (e.target.style.borderColor = T.teal)}
        onBlur={e   => !error && (e.target.style.borderColor = T.border)}
        {...props}
      />
      {hint  && !error && <span style={{ fontSize: 11, color: T.muted }}>{hint}</span>}
      {error && <span style={{ fontSize: 11, color: T.red }}>{error}</span>}
    </div>
  );
}

export function Select({ label, children, ...props }: any) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {label && <label style={{ fontSize: 13, fontWeight: 600, color: T.muted }}>{label}</label>}
      <select style={{
        padding: "11px 14px", borderRadius: 10, fontSize: 14,
        border: `1.5px solid ${T.border}`, outline: "none",
        fontFamily: "inherit", color: T.dark, background: T.white,
        appearance: "none",
      }} {...props}>{children}</select>
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 36 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
        style={{ width: size, height: size, borderRadius: "50%",
          border: `3px solid ${T.tealL}`, borderTopColor: T.teal }}
      />
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, subtitle, action }: any) {
  return (
    <div style={{ textAlign: "center", padding: "48px 24px", color: T.muted }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 18, color: T.dark }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 14, marginBottom: action ? 20 : 0 }}>{subtitle}</div>
      {action}
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
export function Toast({ msg, type, onDone }: { msg: string; type: "success"|"error"|"info"|"warning"; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, []);
  const icons  = { success: "✓", error: "✕", info: "ℹ", warning: "⚠" };
  const colors = { success: T.green, error: T.red, info: T.teal, warning: T.gold };
  return (
    <motion.div
      initial={{ y: 80, opacity: 0, scale: 0.9 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 80, opacity: 0 }}
      style={{
        position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
        background: colors[type], color: T.white,
        padding: "12px 20px", borderRadius: 12, fontWeight: 600, fontSize: 14,
        boxShadow: "0 8px 24px rgba(0,0,0,.2)", zIndex: 9999,
        display: "flex", alignItems: "center", gap: 8,
        whiteSpace: "nowrap", maxWidth: "90vw",
      }}
    >{icons[type]} {msg}</motion.div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ children, onClose, title, width = 480 }: any) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)",
        zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
        onClick={e => e.stopPropagation()}
        style={{ background: T.white, borderRadius: 20, width: "100%", maxWidth: width,
          maxHeight: "90vh", overflowY: "auto" }}
      >
        {title && (
          <div style={{ padding: "20px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.dark }}>{title}</h2>
            <button onClick={onClose} style={{ background: "none", border: "none",
              cursor: "pointer", color: T.muted, fontSize: 20, lineHeight: 1 }}>✕</button>
          </div>
        )}
        {children}
      </motion.div>
    </motion.div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, icon, color, bg, sub }: any) {
  return (
    <Card style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 12, color: T.muted, fontWeight: 600, marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: T.dark }}>{value}</div>
          {sub && <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{sub}</div>}
        </div>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: bg || T.tealL,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
          {icon}
        </div>
      </div>
    </Card>
  );
}

// ── Section Header ────────────────────────────────────────────────────────────
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}`,
      display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.dark }}>{title}</h3>
      {action}
    </div>
  );
}

// ── Page Layout ───────────────────────────────────────────────────────────────
export function PageLayout({ title, subtitle, action, children }: any) {
  return (
    <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: T.dark }}>{title}</h1>
          {subtitle && <p style={{ margin: "4px 0 0", color: T.muted, fontSize: 14 }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Deal Row ──────────────────────────────────────────────────────────────────
export function DealRow({ deal, onClick }: { deal: any; onClick?: () => void }) {
  const sm = STATUS_META[deal.status] || { icon: "•", label: deal.status };
  return (
    <motion.div
      whileHover={{ background: "#F8FAFC" }}
      onClick={onClick}
      style={{ padding: "15px 22px", display: "flex", alignItems: "center",
        gap: 14, cursor: onClick ? "pointer" : "default",
        borderBottom: `1px solid ${T.border}` }}
    >
      <div style={{ width: 42, height: 42, borderRadius: 11, background: T.tealL,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18, flexShrink: 0 }}>
        {sm.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: T.dark,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {deal.itemDescription}
        </div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
          {timeAgo(deal.createdAt)}
          {deal.seller && ` · ${deal.seller.firstName} → ${deal.buyer?.firstName}`}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: T.dark }}>{fmt(deal.amount)}</div>
        <div style={{ marginTop: 4 }}><Badge status={deal.status} /></div>
      </div>
    </motion.div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────
export function Timeline({ steps }: { steps: { label: string; date?: string; done: boolean }[] }) {
  return (
    <div>
      {steps.map((step, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 14,
          padding: "9px 0", opacity: step.done ? 1 : 0.35 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
            background: step.done ? T.teal : T.border,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, color: step.done ? T.white : T.muted, fontWeight: 700 }}>
            {step.done ? "✓" : i + 1}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.dark }}>{step.label}</div>
            {step.date && (
              <div style={{ fontSize: 11, color: T.muted }}>
                {new Date(step.date).toLocaleString("en-EG")}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
