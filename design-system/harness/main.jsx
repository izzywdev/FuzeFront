import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import {
  BrandTokenScope,
  Logo,
  Tabs,
  StatusPill,
  StatCard,
  Stepper,
  SortableList,
  RadioCardGroup,
  TextareaWithCounter,
} from "../index.js";

// Dev-only harness for manually / MCP-driving the net-new portal DS
// primitives commissioned by design/frames/white-label-portal,
// design/frames/portal-admin-consoles and design/frames/app-builder. NOT part of the published package
// ("files" in package.json does not include harness/). Run with:
//   npx vite design-system/harness --config design-system/harness/vite.config.mjs

const section = { marginBottom: "var(--space-10)" };
const h2 = {
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-xl)",
  margin: "0 0 var(--space-4)",
  color: "var(--text-primary)",
};
const row = { display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "center" };

function BrandTokenScopeDemo() {
  const [accent, setAccent] = useState("#2f6df6");
  return (
    <section style={section} data-harness-section="BrandTokenScope">
      <h2 style={h2}>BrandTokenScope</h2>
      <div style={row}>
        <button data-testid="accent-valid" onClick={() => setAccent("#2f6df6")}>
          Valid (CorpABC blue)
        </button>
        <button data-testid="accent-malformed" onClick={() => setAccent("not-a-color")}>
          Malformed
        </button>
        <button data-testid="accent-low-contrast" onClick={() => setAccent("#fef9c3")}>
          Fails AA contrast
        </button>
      </div>
      <BrandTokenScope
        accent={accent}
        data-testid="brand-scope"
        style={{
          marginTop: "var(--space-4)",
          padding: "var(--space-5)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-secondary)",
        }}
      >
        <button
          style={{
            background: "var(--accent-color)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-2) var(--space-4)",
          }}
        >
          Scoped primary button
        </button>
      </BrandTokenScope>
    </section>
  );
}

function LogoDemo() {
  return (
    <section style={section} data-harness-section="Logo">
      <h2 style={h2}>Logo</h2>
      <div style={row}>
        <Logo src="https://this-domain-does-not-resolve.invalid/logo.png" name="Northwind Traders" />
        <Logo name="CorpABC" />
        <Logo name="Ada Lovelace" shape="circle" size="lg" />
        <Logo />
      </div>
    </section>
  );
}

function TabsDemo() {
  const [tab, setTab] = useState("plans");
  return (
    <section style={section} data-harness-section="Tabs">
      <h2 style={h2}>Tabs</h2>
      <Tabs
        ariaLabel="Billing"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "plans", label: "Plans" },
          { value: "invoices", label: "Invoices" },
          { value: "payments", label: "Payments" },
        ]}
      />
      <Tabs
        ariaLabel="Portal admin (link mode)"
        value="users"
        style={{ marginTop: "var(--space-4)" }}
        tabs={[
          { value: "overview", label: "Overview", href: "#overview" },
          { value: "users", label: "Users", href: "#users" },
          { value: "catalog", label: "App catalog", href: "#catalog" },
        ]}
      />
    </section>
  );
}

function StatusPillDemo() {
  const statuses = [
    "online", "active", "verified", "enabled",
    "degraded", "pending", "in-progress", "invited",
    "offline", "suspended", "restricted", "expired",
    "disabled", "not-started",
  ];
  return (
    <section style={section} data-harness-section="StatusPill">
      <h2 style={h2}>StatusPill</h2>
      <div style={row}>
        {statuses.map((s) => (
          <StatusPill key={s} status={s} />
        ))}
      </div>
    </section>
  );
}

function StatCardDemo() {
  return (
    <section style={section} data-harness-section="StatCard">
      <h2 style={h2}>StatCard</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-4)" }}>
        <StatCard label="Users" value={18} meta="3 admins, 2 invites pending" href="#users" />
        <StatCard label="Apps enabled" value={6} meta="of 12 available" />
        <StatCard label="Storage" value={4.2} unit="GB" />
        <StatCard label="Plan" value="Pro" meta="renews Aug 1" />
      </div>
    </section>
  );
}

function StepperDemo() {
  return (
    <section style={section} data-harness-section="Stepper">
      <h2 style={h2}>Stepper</h2>
      <Stepper
        steps={[
          { id: "business", title: "Business details", status: "done" },
          { id: "bank", title: "Bank account", description: "Add a payout account", status: "current" },
          { id: "review", title: "Review & submit", status: "pending" },
        ]}
      />
    </section>
  );
}

const PIPELINE = [
  { id: "launching", title: "Launching" },
  { id: "building", title: "Building" },
  { id: "deploying", title: "Deploying" },
  { id: "deployed", title: "Deployed" },
];
const withStatus = (statuses) => PIPELINE.map((s, i) => ({ ...s, status: statuses[i] }));

function StepperPipelineDemo() {
  return (
    <section style={section} data-harness-section="Stepper-horizontal">
      <h2 style={h2}>Stepper — horizontal</h2>
      <div style={{ display: "grid", gap: "var(--space-6)" }}>
        <Stepper orientation="horizontal" aria-label="In progress" steps={withStatus(["done", "current", "pending", "pending"])} />
        <Stepper orientation="horizontal" aria-label="Failed" steps={withStatus(["done", "done", "failed", "pending"])} />
        <Stepper orientation="horizontal" aria-label="Cancelled" steps={withStatus(["done", "cancelled", "cancelled", "cancelled"])} />
        <Stepper orientation="horizontal" aria-label="Deployed" steps={withStatus(["done", "done", "done", "done"])} />
        <div dir="rtl" data-testid="rtl-stepper">
          <Stepper orientation="horizontal" aria-label="RTL" steps={withStatus(["done", "current", "pending", "pending"])} />
        </div>
      </div>
      <h2 style={{ ...h2, marginTop: "var(--space-8)" }}>Stepper — vertical, failed / cancelled</h2>
      <Stepper
        steps={[
          { id: "a", title: "Business details", status: "done" },
          { id: "b", title: "Bank account", description: "Verification failed", status: "failed" },
          { id: "c", title: "Review", status: "cancelled" },
        ]}
      />
    </section>
  );
}

function TextareaCounterDemo() {
  const [brief, setBrief] = useState("Let team members log expenses with a receipt photo.");
  return (
    <section style={section} data-harness-section="TextareaWithCounter">
      <h2 style={h2}>TextareaWithCounter</h2>
      <div style={{ display: "grid", gap: "var(--space-6)", maxWidth: "640px" }}>
        <TextareaWithCounter
          label="What should it do?"
          maxLength={4000}
          rows={5}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          counterProps={{ "data-counter": "brief" }}
        />
        <TextareaWithCounter label="Over the limit" maxLength={20} rows={2} defaultValue="This text is definitely longer than twenty characters" />
        <TextareaWithCounter label="Strict" maxLength={20} strict rows={2} defaultValue="short" />
        <div dir="rtl" data-testid="rtl-counter">
          <TextareaWithCounter label="RTL notes" maxLength={2000} rows={2} defaultValue="مرحبا" locale="ar-EG" />
        </div>
      </div>
    </section>
  );
}

function RadioCardDemo() {
  const [v, setV] = useState("org");
  return (
    <section style={section} data-harness-section="RadioCardGroup">
      <h2 style={h2}>RadioCardGroup</h2>
      <div style={{ maxWidth: "640px" }}>
        <RadioCardGroup
          ariaLabel="Build target"
          value={v}
          onChange={setV}
          options={[
            { value: "org", label: "My organization", description: "Deploys into your org only." },
            { value: "platform", label: "Marketplace", description: "Request publishing after review." },
            { value: "off", label: "Unavailable", description: "Disabled option.", disabled: true },
          ]}
        />
      </div>
    </section>
  );
}

function SortableListDemo() {
  const [apps, setApps] = useState([
    { id: "crm", name: "CorpABC CRM" },
    { id: "docs", name: "Docs" },
    { id: "analytics", name: "Analytics" },
  ]);
  return (
    <section style={section} data-harness-section="SortableList">
      <h2 style={h2}>SortableList</h2>
      <SortableList
        ariaLabel="Enabled apps"
        items={apps}
        renderItem={(app) => <span>{app.name}</span>}
        onReorder={setApps}
      />
    </section>
  );
}

function Harness() {
  return (
    <div
      style={{
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
        minHeight: "100vh",
        padding: "var(--space-8)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <h1 style={{ fontFamily: "var(--font-display)" }}>Portal DS primitives — harness</h1>
      <BrandTokenScopeDemo />
      <LogoDemo />
      <TabsDemo />
      <StatusPillDemo />
      <StatCardDemo />
      <StepperDemo />
      <StepperPipelineDemo />
      <TextareaCounterDemo />
      <RadioCardDemo />
      <SortableListDemo />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Harness />);
