import { jsx as v, jsxs as W, Fragment as Qe } from "react/jsx-runtime";
import * as Ye from "react";
import { createContext as Lt, useMemo as Oe, useContext as Tt, useState as U, useCallback as Be, useEffect as Ot } from "react";
import { SeamDivider as zt, Button as ae, Select as Le, Avatar as Ht, RoleBadge as ht, StatusPill as vt, IconButton as Gt, DataTable as ot, Modal as st, Toast as Te, Input as St, Textarea as Bt, FileDropZone as Ut, Badge as De } from "@fuzefront/design-system";
const ze = {
  common: {
    cancel: "Cancel",
    close: "Close",
    save: "Save",
    create: "Create",
    loading: "Loading…",
    retry: "Retry",
    actions: "Actions",
    confirm: "Confirm"
  },
  roles: {
    owner: "Owner",
    admin: "Admin",
    member: "Member",
    viewer: "Viewer"
  },
  members: {
    title: "Members",
    email: "Email",
    role: "Role",
    status: "Status",
    joined: "Joined",
    invite: "Invite member",
    remove: "Remove",
    removeConfirm: "Remove this member from the organization?",
    statusActive: "Active",
    statusPending: "Pending",
    statusSuspended: "Suspended",
    emptyTitle: "No members yet",
    emptyBody: "Invite people to collaborate in this organization.",
    errorTitle: "Could not load members",
    errorBody: "Something went wrong while loading members."
  },
  invitations: {
    title: "Pending Invitations",
    pending: "Pending",
    email: "Email",
    role: "Role",
    invited: "Invited",
    expires: "Expires",
    resend: "Resend",
    revoke: "Revoke",
    revokeConfirm: "Revoke this invitation?",
    never: "Never",
    expired: "Expired",
    emptyTitle: "No pending invitations",
    emptyBody: "Invitations you send will appear here until accepted.",
    inviteTitle: "Invite members",
    tabSingle: "Single",
    tabBulk: "Bulk / CSV",
    emailPlaceholder: "name@example.com",
    send: "Send invite",
    sendBulk: "Send invites",
    bulkTextareaLabel: "Email addresses",
    bulkTextareaPlaceholder: "One email per line, or paste a list",
    csvHint: "Drag a CSV file here, or click to choose one",
    csvDropLabel: "Drop CSV file",
    previewTitle: "Recipients",
    invalidEmail: "Enter a valid email address",
    noValidEmails: "Add at least one valid email address",
    invitedCount: "Invited {count} member(s)",
    skipped: "skipped",
    errors: "errors"
  },
  tokens: {
    title: "API Tokens",
    name: "Name",
    type: "Type",
    scopes: "Scopes",
    expires: "Expires",
    lastUsed: "Last used",
    never: "Never",
    typePat: "Personal",
    typeService: "Service",
    newToken: "New token",
    create: "Create token",
    revoke: "Revoke",
    revokeConfirm: "Revoke this token? Applications using it will stop working immediately.",
    revokeTitle: "Revoke token",
    emptyTitle: "No tokens yet",
    emptyBody: "Create one to get programmatic access.",
    namePlaceholder: "e.g. CI deploy token",
    nameLabel: "Token name",
    ownerLabel: "Owner",
    ownerUser: "Personal (acts as you)",
    ownerOrg: "Service (acts as the org)",
    expiryLabel: "Expiry",
    noExpiry: "No expiry",
    scopesLabel: "Scopes",
    revealTitle: "Token created",
    revealWarning: "This token will not be shown again. Copy it now.",
    copy: "Copy",
    copied: "Copied",
    done: "Done",
    createError: "Could not create token",
    expiresSoon: "Expires soon"
  },
  scopeGroups: {
    apps: "Apps",
    organization: "Organization",
    userManagement: "User Management"
  },
  scopeLabels: {
    "App:read": "Read apps",
    "App:create": "Create apps",
    "App:update": "Update apps",
    "App:delete": "Delete apps",
    "App:install": "Install apps",
    "App:uninstall": "Uninstall apps",
    "Organization:read": "Read organization",
    "Organization:update": "Update organization",
    "Organization:manage": "Manage organization",
    "UserManagement:view_members": "View members",
    "UserManagement:invite": "Invite members",
    "UserManagement:remove": "Remove members",
    "UserManagement:update_role": "Change roles"
  }
}, Nt = {
  common: {
    cancel: "ביטול",
    close: "סגירה",
    save: "שמירה",
    create: "יצירה",
    loading: "טוען…",
    retry: "נסה שוב",
    actions: "פעולות",
    confirm: "אישור"
  },
  roles: {
    owner: "בעלים",
    admin: "מנהל",
    member: "חבר",
    viewer: "צופה"
  },
  members: {
    title: "חברים",
    email: "דוא״ל",
    role: "תפקיד",
    status: "סטטוס",
    joined: "הצטרף",
    invite: "הזמן חבר",
    remove: "הסר",
    removeConfirm: "להסיר את החבר הזה מהארגון?",
    statusActive: "פעיל",
    statusPending: "ממתין",
    statusSuspended: "מושעה",
    emptyTitle: "אין חברים עדיין",
    emptyBody: "הזמן אנשים לשתף פעולה בארגון הזה.",
    errorTitle: "לא ניתן לטעון חברים",
    errorBody: "אירעה שגיאה בעת טעינת החברים."
  },
  invitations: {
    title: "הזמנות ממתינות",
    pending: "ממתין",
    email: "דוא״ל",
    role: "תפקיד",
    invited: "הוזמן",
    expires: "פג תוקף",
    resend: "שלח שוב",
    revoke: "בטל",
    revokeConfirm: "לבטל את ההזמנה הזו?",
    never: "אף פעם",
    expired: "פג תוקף",
    emptyTitle: "אין הזמנות ממתינות",
    emptyBody: "הזמנות שתשלח יופיעו כאן עד שיאושרו.",
    inviteTitle: "הזמן חברים",
    tabSingle: "יחיד",
    tabBulk: "מרובה / CSV",
    emailPlaceholder: "name@example.com",
    send: "שלח הזמנה",
    sendBulk: "שלח הזמנות",
    bulkTextareaLabel: "כתובות דוא״ל",
    bulkTextareaPlaceholder: "דוא״ל אחד בכל שורה, או הדבק רשימה",
    csvHint: "גרור קובץ CSV לכאן, או לחץ לבחירה",
    csvDropLabel: "שחרר קובץ CSV",
    previewTitle: "נמענים",
    invalidEmail: "הזן כתובת דוא״ל תקינה",
    noValidEmails: "הוסף לפחות כתובת דוא״ל תקינה אחת",
    invitedCount: "הוזמנו {count} חברים",
    skipped: "דולגו",
    errors: "שגיאות"
  },
  tokens: {
    title: "אסימוני API",
    name: "שם",
    type: "סוג",
    scopes: "הרשאות",
    expires: "פג תוקף",
    lastUsed: "שימוש אחרון",
    never: "אף פעם",
    typePat: "אישי",
    typeService: "שירות",
    newToken: "אסימון חדש",
    create: "צור אסימון",
    revoke: "בטל",
    revokeConfirm: "לבטל את האסימון? יישומים שמשתמשים בו יפסיקו לעבוד מיד.",
    revokeTitle: "ביטול אסימון",
    emptyTitle: "אין אסימונים עדיין",
    emptyBody: "צור אחד כדי לקבל גישה תכנותית.",
    namePlaceholder: "לדוגמה: אסימון פריסה",
    nameLabel: "שם האסימון",
    ownerLabel: "בעלים",
    ownerUser: "אישי (פועל בשמך)",
    ownerOrg: "שירות (פועל בשם הארגון)",
    expiryLabel: "תוקף",
    noExpiry: "ללא תוקף",
    scopesLabel: "הרשאות",
    revealTitle: "האסימון נוצר",
    revealWarning: "האסימון הזה לא יוצג שוב. העתק אותו עכשיו.",
    copy: "העתק",
    copied: "הועתק",
    done: "סיום",
    createError: "לא ניתן ליצור אסימון",
    expiresSoon: "פג תוקף בקרוב"
  },
  scopeGroups: {
    apps: "יישומים",
    organization: "ארגון",
    userManagement: "ניהול משתמשים"
  },
  scopeLabels: {
    "App:read": "קריאת יישומים",
    "App:create": "יצירת יישומים",
    "App:update": "עדכון יישומים",
    "App:delete": "מחיקת יישומים",
    "App:install": "התקנת יישומים",
    "App:uninstall": "הסרת יישומים",
    "Organization:read": "קריאת ארגון",
    "Organization:update": "עדכון ארגון",
    "Organization:manage": "ניהול ארגון",
    "UserManagement:view_members": "צפייה בחברים",
    "UserManagement:invite": "הזמנת חברים",
    "UserManagement:remove": "הסרת חברים",
    "UserManagement:update_role": "שינוי תפקידים"
  }
}, jt = { en: ze, he: Nt }, qt = /* @__PURE__ */ new Set(["he"]), Ct = Lt(null);
function Wt(e) {
  return yt(ze, e);
}
function yt(e, r) {
  const t = { ...e };
  for (const n of Object.keys(r)) {
    const i = r[n], o = e[n];
    i && typeof i == "object" && !Array.isArray(i) && o && typeof o == "object" && !Array.isArray(o) ? t[n] = yt(o, i) : i !== void 0 && i !== "" && (t[n] = i);
  }
  return t;
}
function wt(e, r) {
  return r ? e.replace(
    /\{(\w+)\}/g,
    (t, n) => n in r ? String(r[n]) : t
  ) : e;
}
function Kt({ locale: e = "en", children: r }) {
  const t = Oe(() => {
    const n = jt[e] ?? ze, i = Wt(n);
    return {
      locale: e,
      dir: qt.has(e) ? "rtl" : "ltr",
      messages: i,
      t: wt
    };
  }, [e]);
  return /* @__PURE__ */ v(Ct.Provider, { value: t, children: r });
}
function Ce() {
  const e = Tt(Ct);
  return e || {
    locale: "en",
    dir: "ltr",
    messages: ze,
    t: wt
  };
}
class Xt extends Error {
  constructor(r, t, n) {
    super(t), this.name = "HttpError", this.status = r, this.body = n;
  }
}
class _t {
  constructor(r = {}) {
    this.baseUrl = r.baseUrl ?? "", this.getToken = r.getToken, this.fetchImpl = r.fetchImpl ?? globalThis.fetch;
  }
  async request(r, t, n) {
    var g;
    const i = { Accept: "application/json" }, o = (g = this.getToken) == null ? void 0 : g.call(this);
    o && (i.Authorization = `Bearer ${o}`);
    let s;
    n !== void 0 && (i["Content-Type"] = "application/json", s = JSON.stringify(n));
    const u = await this.fetchImpl(`${this.baseUrl}${t}`, {
      method: r,
      headers: i,
      body: s
    }), a = await u.text(), l = a ? Jt(a) : void 0;
    if (!u.ok) {
      const S = (l && typeof l == "object" && "error" in l ? String(l.error) : u.statusText) || `Request failed with ${u.status}`;
      throw new Xt(u.status, S, l);
    }
    return l;
  }
  get(r) {
    return this.request("GET", r);
  }
  post(r, t) {
    return this.request("POST", r, t);
  }
  put(r, t) {
    return this.request("PUT", r, t);
  }
  delete(r) {
    return this.request("DELETE", r);
  }
}
function Jt(e) {
  try {
    return JSON.parse(e);
  } catch {
    return e;
  }
}
function Qt(e = {}) {
  const r = new _t(e);
  return {
    async listTokens() {
      return (await r.get("/api/tokens")).tokens;
    },
    async listOrgTokens(t) {
      return (await r.get(
        `/api/organizations/${encodeURIComponent(t)}/tokens`
      )).tokens;
    },
    createToken(t) {
      return r.post("/api/tokens", t);
    },
    async revokeToken(t) {
      await r.delete(`/api/tokens/${encodeURIComponent(t)}`);
    }
  };
}
function Yt(e = {}) {
  const r = new _t(e), t = Qt(e), n = (i) => `/api/organizations/${encodeURIComponent(i)}`;
  return {
    listMembers(i) {
      return r.get(`${n(i)}/members`);
    },
    async updateMemberRole(i, o, s) {
      await r.put(`${n(i)}/members/${encodeURIComponent(o)}`, { role: s });
    },
    async removeMember(i, o) {
      await r.delete(`${n(i)}/members/${encodeURIComponent(o)}`);
    },
    async listInvitations(i, o = "pending") {
      const s = o === "all" ? "?status=all" : "";
      return (await r.get(`${n(i)}/invitations${s}`)).invitations;
    },
    async invite(i, o, s) {
      await r.post(`${n(i)}/invitations`, { email: o, role: s });
    },
    async bulkInvite(i, o) {
      var f;
      const s = ((f = o[0]) == null ? void 0 : f.role) ?? "member", u = o.map((h) => h.email), l = (await r.post(`${n(i)}/invitations/bulk`, { emails: u, role: s })).results ?? [], g = l.filter((h) => h.status === "invited").length, S = l.filter((h) => h.status === "skipped").length, p = l.filter((h) => h.error).map((h) => `${h.email}: ${h.error}`);
      return { created: g, skipped: S, errors: p };
    },
    async resendInvitation(i, o) {
      await r.post(`${n(i)}/invitations/${encodeURIComponent(o)}/resend`);
    },
    async revokeInvitation(i, o) {
      await r.delete(`${n(i)}/invitations/${encodeURIComponent(o)}`);
    },
    listTokens() {
      return t.listTokens();
    },
    listOrgTokens(i) {
      return t.listOrgTokens(i);
    },
    createToken(i) {
      return t.createToken(i);
    },
    revokeToken(i) {
      return t.revokeToken(i);
    }
  };
}
/**
   * table-core
   *
   * Copyright (c) TanStack
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE.md file in the root directory of this source tree.
   *
   * @license MIT
   */
function Zt() {
  return {
    accessor: (e, r) => typeof e == "function" ? {
      ...r,
      accessorFn: e
    } : {
      ...r,
      accessorKey: e
    },
    display: (e) => e,
    group: (e) => e
  };
}
function we(e, r) {
  return typeof e == "function" ? e(r) : e;
}
function de(e, r) {
  return (t) => {
    r.setState((n) => ({
      ...n,
      [e]: we(t, n[e])
    }));
  };
}
function He(e) {
  return e instanceof Function;
}
function en(e) {
  return Array.isArray(e) && e.every((r) => typeof r == "number");
}
function tn(e, r) {
  const t = [], n = (i) => {
    i.forEach((o) => {
      t.push(o);
      const s = r(o);
      s != null && s.length && n(s);
    });
  };
  return n(e), t;
}
function $(e, r, t) {
  let n = [], i;
  return (o) => {
    let s;
    t.key && t.debug && (s = Date.now());
    const u = e(o);
    if (!(u.length !== n.length || u.some((g, S) => n[S] !== g)))
      return i;
    n = u;
    let l;
    if (t.key && t.debug && (l = Date.now()), i = r(...u), t == null || t.onChange == null || t.onChange(i), t.key && t.debug && t != null && t.debug()) {
      const g = Math.round((Date.now() - s) * 100) / 100, S = Math.round((Date.now() - l) * 100) / 100, p = S / 16, f = (h, y) => {
        for (h = String(h); h.length < y; )
          h = " " + h;
        return h;
      };
      console.info(`%c⏱ ${f(S, 5)} /${f(g, 5)} ms`, `
            font-size: .6rem;
            font-weight: bold;
            color: hsl(${Math.max(0, Math.min(120 - 120 * p, 120))}deg 100% 31%);`, t == null ? void 0 : t.key);
    }
    return i;
  };
}
function M(e, r, t, n) {
  return {
    debug: () => {
      var i;
      return (i = e == null ? void 0 : e.debugAll) != null ? i : e[r];
    },
    key: process.env.NODE_ENV === "development" && t,
    onChange: n
  };
}
function nn(e, r, t, n) {
  const i = () => {
    var s;
    return (s = o.getValue()) != null ? s : e.options.renderFallbackValue;
  }, o = {
    id: `${r.id}_${t.id}`,
    row: r,
    column: t,
    getValue: () => r.getValue(n),
    renderValue: i,
    getContext: $(() => [e, t, r, o], (s, u, a, l) => ({
      table: s,
      column: u,
      row: a,
      cell: l,
      getValue: l.getValue,
      renderValue: l.renderValue
    }), M(e.options, "debugCells", "cell.getContext"))
  };
  return e._features.forEach((s) => {
    s.createCell == null || s.createCell(o, t, r, e);
  }, {}), o;
}
function rn(e, r, t, n) {
  var i, o;
  const u = {
    ...e._getDefaultColumnDef(),
    ...r
  }, a = u.accessorKey;
  let l = (i = (o = u.id) != null ? o : a ? typeof String.prototype.replaceAll == "function" ? a.replaceAll(".", "_") : a.replace(/\./g, "_") : void 0) != null ? i : typeof u.header == "string" ? u.header : void 0, g;
  if (u.accessorFn ? g = u.accessorFn : a && (a.includes(".") ? g = (p) => {
    let f = p;
    for (const y of a.split(".")) {
      var h;
      f = (h = f) == null ? void 0 : h[y], process.env.NODE_ENV !== "production" && f === void 0 && console.warn(`"${y}" in deeply nested key "${a}" returned undefined.`);
    }
    return f;
  } : g = (p) => p[u.accessorKey]), !l)
    throw process.env.NODE_ENV !== "production" ? new Error(u.accessorFn ? "Columns require an id when using an accessorFn" : "Columns require an id when using a non-string header") : new Error();
  let S = {
    id: `${String(l)}`,
    accessorFn: g,
    parent: n,
    depth: t,
    columnDef: u,
    columns: [],
    getFlatColumns: $(() => [!0], () => {
      var p;
      return [S, ...(p = S.columns) == null ? void 0 : p.flatMap((f) => f.getFlatColumns())];
    }, M(e.options, "debugColumns", "column.getFlatColumns")),
    getLeafColumns: $(() => [e._getOrderColumnsFn()], (p) => {
      var f;
      if ((f = S.columns) != null && f.length) {
        let h = S.columns.flatMap((y) => y.getLeafColumns());
        return p(h);
      }
      return [S];
    }, M(e.options, "debugColumns", "column.getLeafColumns"))
  };
  for (const p of e._features)
    p.createColumn == null || p.createColumn(S, e);
  return S;
}
const le = "debugHeaders";
function gt(e, r, t) {
  var n;
  let o = {
    id: (n = t.id) != null ? n : r.id,
    column: r,
    index: t.index,
    isPlaceholder: !!t.isPlaceholder,
    placeholderId: t.placeholderId,
    depth: t.depth,
    subHeaders: [],
    colSpan: 0,
    rowSpan: 0,
    headerGroup: null,
    getLeafHeaders: () => {
      const s = [], u = (a) => {
        a.subHeaders && a.subHeaders.length && a.subHeaders.map(u), s.push(a);
      };
      return u(o), s;
    },
    getContext: () => ({
      table: e,
      header: o,
      column: r
    })
  };
  return e._features.forEach((s) => {
    s.createHeader == null || s.createHeader(o, e);
  }), o;
}
const on = {
  createTable: (e) => {
    e.getHeaderGroups = $(() => [e.getAllColumns(), e.getVisibleLeafColumns(), e.getState().columnPinning.left, e.getState().columnPinning.right], (r, t, n, i) => {
      var o, s;
      const u = (o = n == null ? void 0 : n.map((S) => t.find((p) => p.id === S)).filter(Boolean)) != null ? o : [], a = (s = i == null ? void 0 : i.map((S) => t.find((p) => p.id === S)).filter(Boolean)) != null ? s : [], l = t.filter((S) => !(n != null && n.includes(S.id)) && !(i != null && i.includes(S.id)));
      return Ve(r, [...u, ...l, ...a], e);
    }, M(e.options, le, "getHeaderGroups")), e.getCenterHeaderGroups = $(() => [e.getAllColumns(), e.getVisibleLeafColumns(), e.getState().columnPinning.left, e.getState().columnPinning.right], (r, t, n, i) => (t = t.filter((o) => !(n != null && n.includes(o.id)) && !(i != null && i.includes(o.id))), Ve(r, t, e, "center")), M(e.options, le, "getCenterHeaderGroups")), e.getLeftHeaderGroups = $(() => [e.getAllColumns(), e.getVisibleLeafColumns(), e.getState().columnPinning.left], (r, t, n) => {
      var i;
      const o = (i = n == null ? void 0 : n.map((s) => t.find((u) => u.id === s)).filter(Boolean)) != null ? i : [];
      return Ve(r, o, e, "left");
    }, M(e.options, le, "getLeftHeaderGroups")), e.getRightHeaderGroups = $(() => [e.getAllColumns(), e.getVisibleLeafColumns(), e.getState().columnPinning.right], (r, t, n) => {
      var i;
      const o = (i = n == null ? void 0 : n.map((s) => t.find((u) => u.id === s)).filter(Boolean)) != null ? i : [];
      return Ve(r, o, e, "right");
    }, M(e.options, le, "getRightHeaderGroups")), e.getFooterGroups = $(() => [e.getHeaderGroups()], (r) => [...r].reverse(), M(e.options, le, "getFooterGroups")), e.getLeftFooterGroups = $(() => [e.getLeftHeaderGroups()], (r) => [...r].reverse(), M(e.options, le, "getLeftFooterGroups")), e.getCenterFooterGroups = $(() => [e.getCenterHeaderGroups()], (r) => [...r].reverse(), M(e.options, le, "getCenterFooterGroups")), e.getRightFooterGroups = $(() => [e.getRightHeaderGroups()], (r) => [...r].reverse(), M(e.options, le, "getRightFooterGroups")), e.getFlatHeaders = $(() => [e.getHeaderGroups()], (r) => r.map((t) => t.headers).flat(), M(e.options, le, "getFlatHeaders")), e.getLeftFlatHeaders = $(() => [e.getLeftHeaderGroups()], (r) => r.map((t) => t.headers).flat(), M(e.options, le, "getLeftFlatHeaders")), e.getCenterFlatHeaders = $(() => [e.getCenterHeaderGroups()], (r) => r.map((t) => t.headers).flat(), M(e.options, le, "getCenterFlatHeaders")), e.getRightFlatHeaders = $(() => [e.getRightHeaderGroups()], (r) => r.map((t) => t.headers).flat(), M(e.options, le, "getRightFlatHeaders")), e.getCenterLeafHeaders = $(() => [e.getCenterFlatHeaders()], (r) => r.filter((t) => {
      var n;
      return !((n = t.subHeaders) != null && n.length);
    }), M(e.options, le, "getCenterLeafHeaders")), e.getLeftLeafHeaders = $(() => [e.getLeftFlatHeaders()], (r) => r.filter((t) => {
      var n;
      return !((n = t.subHeaders) != null && n.length);
    }), M(e.options, le, "getLeftLeafHeaders")), e.getRightLeafHeaders = $(() => [e.getRightFlatHeaders()], (r) => r.filter((t) => {
      var n;
      return !((n = t.subHeaders) != null && n.length);
    }), M(e.options, le, "getRightLeafHeaders")), e.getLeafHeaders = $(() => [e.getLeftHeaderGroups(), e.getCenterHeaderGroups(), e.getRightHeaderGroups()], (r, t, n) => {
      var i, o, s, u, a, l;
      return [...(i = (o = r[0]) == null ? void 0 : o.headers) != null ? i : [], ...(s = (u = t[0]) == null ? void 0 : u.headers) != null ? s : [], ...(a = (l = n[0]) == null ? void 0 : l.headers) != null ? a : []].map((g) => g.getLeafHeaders()).flat();
    }, M(e.options, le, "getLeafHeaders"));
  }
};
function Ve(e, r, t, n) {
  var i, o;
  let s = 0;
  const u = function(p, f) {
    f === void 0 && (f = 1), s = Math.max(s, f), p.filter((h) => h.getIsVisible()).forEach((h) => {
      var y;
      (y = h.columns) != null && y.length && u(h.columns, f + 1);
    }, 0);
  };
  u(e);
  let a = [];
  const l = (p, f) => {
    const h = {
      depth: f,
      id: [n, `${f}`].filter(Boolean).join("_"),
      headers: []
    }, y = [];
    p.forEach((F) => {
      const I = [...y].reverse()[0], H = F.column.depth === h.depth;
      let _, k = !1;
      if (H && F.column.parent ? _ = F.column.parent : (_ = F.column, k = !0), I && (I == null ? void 0 : I.column) === _)
        I.subHeaders.push(F);
      else {
        const A = gt(t, _, {
          id: [n, f, _.id, F == null ? void 0 : F.id].filter(Boolean).join("_"),
          isPlaceholder: k,
          placeholderId: k ? `${y.filter((T) => T.column === _).length}` : void 0,
          depth: f,
          index: y.length
        });
        A.subHeaders.push(F), y.push(A);
      }
      h.headers.push(F), F.headerGroup = h;
    }), a.push(h), f > 0 && l(y, f - 1);
  }, g = r.map((p, f) => gt(t, p, {
    depth: s,
    index: f
  }));
  l(g, s - 1), a.reverse();
  const S = (p) => p.filter((h) => h.column.getIsVisible()).map((h) => {
    let y = 0, F = 0, I = [0];
    h.subHeaders && h.subHeaders.length ? (I = [], S(h.subHeaders).forEach((_) => {
      let {
        colSpan: k,
        rowSpan: A
      } = _;
      y += k, I.push(A);
    })) : y = 1;
    const H = Math.min(...I);
    return F = F + H, h.colSpan = y, h.rowSpan = F, {
      colSpan: y,
      rowSpan: F
    };
  });
  return S((i = (o = a[0]) == null ? void 0 : o.headers) != null ? i : []), a;
}
const sn = (e, r, t, n, i, o, s) => {
  let u = {
    id: r,
    index: n,
    original: t,
    depth: i,
    parentId: s,
    _valuesCache: {},
    _uniqueValuesCache: {},
    getValue: (a) => {
      if (u._valuesCache.hasOwnProperty(a))
        return u._valuesCache[a];
      const l = e.getColumn(a);
      if (l != null && l.accessorFn)
        return u._valuesCache[a] = l.accessorFn(u.original, n), u._valuesCache[a];
    },
    getUniqueValues: (a) => {
      if (u._uniqueValuesCache.hasOwnProperty(a))
        return u._uniqueValuesCache[a];
      const l = e.getColumn(a);
      if (l != null && l.accessorFn)
        return l.columnDef.getUniqueValues ? (u._uniqueValuesCache[a] = l.columnDef.getUniqueValues(u.original, n), u._uniqueValuesCache[a]) : (u._uniqueValuesCache[a] = [u.getValue(a)], u._uniqueValuesCache[a]);
    },
    renderValue: (a) => {
      var l;
      return (l = u.getValue(a)) != null ? l : e.options.renderFallbackValue;
    },
    subRows: [],
    getLeafRows: () => tn(u.subRows, (a) => a.subRows),
    getParentRow: () => u.parentId ? e.getRow(u.parentId, !0) : void 0,
    getParentRows: () => {
      let a = [], l = u;
      for (; ; ) {
        const g = l.getParentRow();
        if (!g) break;
        a.push(g), l = g;
      }
      return a.reverse();
    },
    getAllCells: $(() => [e.getAllLeafColumns()], (a) => a.map((l) => nn(e, u, l, l.id)), M(e.options, "debugRows", "getAllCells")),
    _getAllCellsByColumnId: $(() => [u.getAllCells()], (a) => a.reduce((l, g) => (l[g.column.id] = g, l), {}), M(e.options, "debugRows", "getAllCellsByColumnId"))
  };
  for (let a = 0; a < e._features.length; a++) {
    const l = e._features[a];
    l == null || l.createRow == null || l.createRow(u, e);
  }
  return u;
}, ln = {
  createColumn: (e, r) => {
    e._getFacetedRowModel = r.options.getFacetedRowModel && r.options.getFacetedRowModel(r, e.id), e.getFacetedRowModel = () => e._getFacetedRowModel ? e._getFacetedRowModel() : r.getPreFilteredRowModel(), e._getFacetedUniqueValues = r.options.getFacetedUniqueValues && r.options.getFacetedUniqueValues(r, e.id), e.getFacetedUniqueValues = () => e._getFacetedUniqueValues ? e._getFacetedUniqueValues() : /* @__PURE__ */ new Map(), e._getFacetedMinMaxValues = r.options.getFacetedMinMaxValues && r.options.getFacetedMinMaxValues(r, e.id), e.getFacetedMinMaxValues = () => {
      if (e._getFacetedMinMaxValues)
        return e._getFacetedMinMaxValues();
    };
  }
}, Rt = (e, r, t) => {
  var n, i;
  const o = t == null || (n = t.toString()) == null ? void 0 : n.toLowerCase();
  return !!(!((i = e.getValue(r)) == null || (i = i.toString()) == null || (i = i.toLowerCase()) == null) && i.includes(o));
};
Rt.autoRemove = (e) => fe(e);
const xt = (e, r, t) => {
  var n;
  return !!(!((n = e.getValue(r)) == null || (n = n.toString()) == null) && n.includes(t));
};
xt.autoRemove = (e) => fe(e);
const kt = (e, r, t) => {
  var n;
  return ((n = e.getValue(r)) == null || (n = n.toString()) == null ? void 0 : n.toLowerCase()) === (t == null ? void 0 : t.toLowerCase());
};
kt.autoRemove = (e) => fe(e);
const Ft = (e, r, t) => {
  var n;
  return (n = e.getValue(r)) == null ? void 0 : n.includes(t);
};
Ft.autoRemove = (e) => fe(e);
const Et = (e, r, t) => !t.some((n) => {
  var i;
  return !((i = e.getValue(r)) != null && i.includes(n));
});
Et.autoRemove = (e) => fe(e) || !(e != null && e.length);
const It = (e, r, t) => t.some((n) => {
  var i;
  return (i = e.getValue(r)) == null ? void 0 : i.includes(n);
});
It.autoRemove = (e) => fe(e) || !(e != null && e.length);
const $t = (e, r, t) => e.getValue(r) === t;
$t.autoRemove = (e) => fe(e);
const Mt = (e, r, t) => e.getValue(r) == t;
Mt.autoRemove = (e) => fe(e);
const lt = (e, r, t) => {
  let [n, i] = t;
  const o = e.getValue(r);
  return o >= n && o <= i;
};
lt.resolveFilterValue = (e) => {
  let [r, t] = e, n = typeof r != "number" ? parseFloat(r) : r, i = typeof t != "number" ? parseFloat(t) : t, o = r === null || Number.isNaN(n) ? -1 / 0 : n, s = t === null || Number.isNaN(i) ? 1 / 0 : i;
  if (o > s) {
    const u = o;
    o = s, s = u;
  }
  return [o, s];
};
lt.autoRemove = (e) => fe(e) || fe(e[0]) && fe(e[1]);
const Se = {
  includesString: Rt,
  includesStringSensitive: xt,
  equalsString: kt,
  arrIncludes: Ft,
  arrIncludesAll: Et,
  arrIncludesSome: It,
  equals: $t,
  weakEquals: Mt,
  inNumberRange: lt
};
function fe(e) {
  return e == null || e === "";
}
const an = {
  getDefaultColumnDef: () => ({
    filterFn: "auto"
  }),
  getInitialState: (e) => ({
    columnFilters: [],
    ...e
  }),
  getDefaultOptions: (e) => ({
    onColumnFiltersChange: de("columnFilters", e),
    filterFromLeafRows: !1,
    maxLeafRowFilterDepth: 100
  }),
  createColumn: (e, r) => {
    e.getAutoFilterFn = () => {
      const t = r.getCoreRowModel().flatRows[0], n = t == null ? void 0 : t.getValue(e.id);
      return typeof n == "string" ? Se.includesString : typeof n == "number" ? Se.inNumberRange : typeof n == "boolean" || n !== null && typeof n == "object" ? Se.equals : Array.isArray(n) ? Se.arrIncludes : Se.weakEquals;
    }, e.getFilterFn = () => {
      var t, n;
      return He(e.columnDef.filterFn) ? e.columnDef.filterFn : e.columnDef.filterFn === "auto" ? e.getAutoFilterFn() : (
        // @ts-ignore
        (t = (n = r.options.filterFns) == null ? void 0 : n[e.columnDef.filterFn]) != null ? t : Se[e.columnDef.filterFn]
      );
    }, e.getCanFilter = () => {
      var t, n, i;
      return ((t = e.columnDef.enableColumnFilter) != null ? t : !0) && ((n = r.options.enableColumnFilters) != null ? n : !0) && ((i = r.options.enableFilters) != null ? i : !0) && !!e.accessorFn;
    }, e.getIsFiltered = () => e.getFilterIndex() > -1, e.getFilterValue = () => {
      var t;
      return (t = r.getState().columnFilters) == null || (t = t.find((n) => n.id === e.id)) == null ? void 0 : t.value;
    }, e.getFilterIndex = () => {
      var t, n;
      return (t = (n = r.getState().columnFilters) == null ? void 0 : n.findIndex((i) => i.id === e.id)) != null ? t : -1;
    }, e.setFilterValue = (t) => {
      r.setColumnFilters((n) => {
        const i = e.getFilterFn(), o = n == null ? void 0 : n.find((g) => g.id === e.id), s = we(t, o ? o.value : void 0);
        if (ft(i, s, e)) {
          var u;
          return (u = n == null ? void 0 : n.filter((g) => g.id !== e.id)) != null ? u : [];
        }
        const a = {
          id: e.id,
          value: s
        };
        if (o) {
          var l;
          return (l = n == null ? void 0 : n.map((g) => g.id === e.id ? a : g)) != null ? l : [];
        }
        return n != null && n.length ? [...n, a] : [a];
      });
    };
  },
  createRow: (e, r) => {
    e.columnFilters = {}, e.columnFiltersMeta = {};
  },
  createTable: (e) => {
    e.setColumnFilters = (r) => {
      const t = e.getAllLeafColumns(), n = (i) => {
        var o;
        return (o = we(r, i)) == null ? void 0 : o.filter((s) => {
          const u = t.find((a) => a.id === s.id);
          if (u) {
            const a = u.getFilterFn();
            if (ft(a, s.value, u))
              return !1;
          }
          return !0;
        });
      };
      e.options.onColumnFiltersChange == null || e.options.onColumnFiltersChange(n);
    }, e.resetColumnFilters = (r) => {
      var t, n;
      e.setColumnFilters(r ? [] : (t = (n = e.initialState) == null ? void 0 : n.columnFilters) != null ? t : []);
    }, e.getPreFilteredRowModel = () => e.getCoreRowModel(), e.getFilteredRowModel = () => (!e._getFilteredRowModel && e.options.getFilteredRowModel && (e._getFilteredRowModel = e.options.getFilteredRowModel(e)), e.options.manualFiltering || !e._getFilteredRowModel ? e.getPreFilteredRowModel() : e._getFilteredRowModel());
  }
};
function ft(e, r, t) {
  return (e && e.autoRemove ? e.autoRemove(r, t) : !1) || typeof r > "u" || typeof r == "string" && !r;
}
const un = (e, r, t) => t.reduce((n, i) => {
  const o = i.getValue(e);
  return n + (typeof o == "number" ? o : 0);
}, 0), dn = (e, r, t) => {
  let n;
  return t.forEach((i) => {
    const o = i.getValue(e);
    o != null && (n > o || n === void 0 && o >= o) && (n = o);
  }), n;
}, cn = (e, r, t) => {
  let n;
  return t.forEach((i) => {
    const o = i.getValue(e);
    o != null && (n < o || n === void 0 && o >= o) && (n = o);
  }), n;
}, gn = (e, r, t) => {
  let n, i;
  return t.forEach((o) => {
    const s = o.getValue(e);
    s != null && (n === void 0 ? s >= s && (n = i = s) : (n > s && (n = s), i < s && (i = s)));
  }), [n, i];
}, fn = (e, r) => {
  let t = 0, n = 0;
  if (r.forEach((i) => {
    let o = i.getValue(e);
    o != null && (o = +o) >= o && (++t, n += o);
  }), t) return n / t;
}, pn = (e, r) => {
  if (!r.length)
    return;
  const t = r.map((o) => o.getValue(e));
  if (!en(t))
    return;
  if (t.length === 1)
    return t[0];
  const n = Math.floor(t.length / 2), i = t.sort((o, s) => o - s);
  return t.length % 2 !== 0 ? i[n] : (i[n - 1] + i[n]) / 2;
}, mn = (e, r) => Array.from(new Set(r.map((t) => t.getValue(e))).values()), hn = (e, r) => new Set(r.map((t) => t.getValue(e))).size, vn = (e, r) => r.length, Ue = {
  sum: un,
  min: dn,
  max: cn,
  extent: gn,
  mean: fn,
  median: pn,
  unique: mn,
  uniqueCount: hn,
  count: vn
}, Sn = {
  getDefaultColumnDef: () => ({
    aggregatedCell: (e) => {
      var r, t;
      return (r = (t = e.getValue()) == null || t.toString == null ? void 0 : t.toString()) != null ? r : null;
    },
    aggregationFn: "auto"
  }),
  getInitialState: (e) => ({
    grouping: [],
    ...e
  }),
  getDefaultOptions: (e) => ({
    onGroupingChange: de("grouping", e),
    groupedColumnMode: "reorder"
  }),
  createColumn: (e, r) => {
    e.toggleGrouping = () => {
      r.setGrouping((t) => t != null && t.includes(e.id) ? t.filter((n) => n !== e.id) : [...t ?? [], e.id]);
    }, e.getCanGroup = () => {
      var t, n;
      return ((t = e.columnDef.enableGrouping) != null ? t : !0) && ((n = r.options.enableGrouping) != null ? n : !0) && (!!e.accessorFn || !!e.columnDef.getGroupingValue);
    }, e.getIsGrouped = () => {
      var t;
      return (t = r.getState().grouping) == null ? void 0 : t.includes(e.id);
    }, e.getGroupedIndex = () => {
      var t;
      return (t = r.getState().grouping) == null ? void 0 : t.indexOf(e.id);
    }, e.getToggleGroupingHandler = () => {
      const t = e.getCanGroup();
      return () => {
        t && e.toggleGrouping();
      };
    }, e.getAutoAggregationFn = () => {
      const t = r.getCoreRowModel().flatRows[0], n = t == null ? void 0 : t.getValue(e.id);
      if (typeof n == "number")
        return Ue.sum;
      if (Object.prototype.toString.call(n) === "[object Date]")
        return Ue.extent;
    }, e.getAggregationFn = () => {
      var t, n;
      if (!e)
        throw new Error();
      return He(e.columnDef.aggregationFn) ? e.columnDef.aggregationFn : e.columnDef.aggregationFn === "auto" ? e.getAutoAggregationFn() : (t = (n = r.options.aggregationFns) == null ? void 0 : n[e.columnDef.aggregationFn]) != null ? t : Ue[e.columnDef.aggregationFn];
    };
  },
  createTable: (e) => {
    e.setGrouping = (r) => e.options.onGroupingChange == null ? void 0 : e.options.onGroupingChange(r), e.resetGrouping = (r) => {
      var t, n;
      e.setGrouping(r ? [] : (t = (n = e.initialState) == null ? void 0 : n.grouping) != null ? t : []);
    }, e.getPreGroupedRowModel = () => e.getFilteredRowModel(), e.getGroupedRowModel = () => (!e._getGroupedRowModel && e.options.getGroupedRowModel && (e._getGroupedRowModel = e.options.getGroupedRowModel(e)), e.options.manualGrouping || !e._getGroupedRowModel ? e.getPreGroupedRowModel() : e._getGroupedRowModel());
  },
  createRow: (e, r) => {
    e.getIsGrouped = () => !!e.groupingColumnId, e.getGroupingValue = (t) => {
      if (e._groupingValuesCache.hasOwnProperty(t))
        return e._groupingValuesCache[t];
      const n = r.getColumn(t);
      return n != null && n.columnDef.getGroupingValue ? (e._groupingValuesCache[t] = n.columnDef.getGroupingValue(e.original), e._groupingValuesCache[t]) : e.getValue(t);
    }, e._groupingValuesCache = {};
  },
  createCell: (e, r, t, n) => {
    e.getIsGrouped = () => r.getIsGrouped() && r.id === t.groupingColumnId, e.getIsPlaceholder = () => !e.getIsGrouped() && r.getIsGrouped(), e.getIsAggregated = () => {
      var i;
      return !e.getIsGrouped() && !e.getIsPlaceholder() && !!((i = t.subRows) != null && i.length);
    };
  }
};
function Cn(e, r, t) {
  if (!(r != null && r.length) || !t)
    return e;
  const n = e.filter((o) => !r.includes(o.id));
  return t === "remove" ? n : [...r.map((o) => e.find((s) => s.id === o)).filter(Boolean), ...n];
}
const yn = {
  getInitialState: (e) => ({
    columnOrder: [],
    ...e
  }),
  getDefaultOptions: (e) => ({
    onColumnOrderChange: de("columnOrder", e)
  }),
  createColumn: (e, r) => {
    e.getIndex = $((t) => [Me(r, t)], (t) => t.findIndex((n) => n.id === e.id), M(r.options, "debugColumns", "getIndex")), e.getIsFirstColumn = (t) => {
      var n;
      return ((n = Me(r, t)[0]) == null ? void 0 : n.id) === e.id;
    }, e.getIsLastColumn = (t) => {
      var n;
      const i = Me(r, t);
      return ((n = i[i.length - 1]) == null ? void 0 : n.id) === e.id;
    };
  },
  createTable: (e) => {
    e.setColumnOrder = (r) => e.options.onColumnOrderChange == null ? void 0 : e.options.onColumnOrderChange(r), e.resetColumnOrder = (r) => {
      var t;
      e.setColumnOrder(r ? [] : (t = e.initialState.columnOrder) != null ? t : []);
    }, e._getOrderColumnsFn = $(() => [e.getState().columnOrder, e.getState().grouping, e.options.groupedColumnMode], (r, t, n) => (i) => {
      let o = [];
      if (!(r != null && r.length))
        o = i;
      else {
        const s = [...r], u = [...i];
        for (; u.length && s.length; ) {
          const a = s.shift(), l = u.findIndex((g) => g.id === a);
          l > -1 && o.push(u.splice(l, 1)[0]);
        }
        o = [...o, ...u];
      }
      return Cn(o, t, n);
    }, M(e.options, "debugTable", "_getOrderColumnsFn"));
  }
}, Ne = () => ({
  left: [],
  right: []
}), wn = {
  getInitialState: (e) => ({
    columnPinning: Ne(),
    ...e
  }),
  getDefaultOptions: (e) => ({
    onColumnPinningChange: de("columnPinning", e)
  }),
  createColumn: (e, r) => {
    e.pin = (t) => {
      const n = e.getLeafColumns().map((i) => i.id).filter(Boolean);
      r.setColumnPinning((i) => {
        var o, s;
        if (t === "right") {
          var u, a;
          return {
            left: ((u = i == null ? void 0 : i.left) != null ? u : []).filter((S) => !(n != null && n.includes(S))),
            right: [...((a = i == null ? void 0 : i.right) != null ? a : []).filter((S) => !(n != null && n.includes(S))), ...n]
          };
        }
        if (t === "left") {
          var l, g;
          return {
            left: [...((l = i == null ? void 0 : i.left) != null ? l : []).filter((S) => !(n != null && n.includes(S))), ...n],
            right: ((g = i == null ? void 0 : i.right) != null ? g : []).filter((S) => !(n != null && n.includes(S)))
          };
        }
        return {
          left: ((o = i == null ? void 0 : i.left) != null ? o : []).filter((S) => !(n != null && n.includes(S))),
          right: ((s = i == null ? void 0 : i.right) != null ? s : []).filter((S) => !(n != null && n.includes(S)))
        };
      });
    }, e.getCanPin = () => e.getLeafColumns().some((n) => {
      var i, o, s;
      return ((i = n.columnDef.enablePinning) != null ? i : !0) && ((o = (s = r.options.enableColumnPinning) != null ? s : r.options.enablePinning) != null ? o : !0);
    }), e.getIsPinned = () => {
      const t = e.getLeafColumns().map((u) => u.id), {
        left: n,
        right: i
      } = r.getState().columnPinning, o = t.some((u) => n == null ? void 0 : n.includes(u)), s = t.some((u) => i == null ? void 0 : i.includes(u));
      return o ? "left" : s ? "right" : !1;
    }, e.getPinnedIndex = () => {
      var t, n;
      const i = e.getIsPinned();
      return i ? (t = (n = r.getState().columnPinning) == null || (n = n[i]) == null ? void 0 : n.indexOf(e.id)) != null ? t : -1 : 0;
    };
  },
  createRow: (e, r) => {
    e.getCenterVisibleCells = $(() => [e._getAllVisibleCells(), r.getState().columnPinning.left, r.getState().columnPinning.right], (t, n, i) => {
      const o = [...n ?? [], ...i ?? []];
      return t.filter((s) => !o.includes(s.column.id));
    }, M(r.options, "debugRows", "getCenterVisibleCells")), e.getLeftVisibleCells = $(() => [e._getAllVisibleCells(), r.getState().columnPinning.left], (t, n) => (n ?? []).map((o) => t.find((s) => s.column.id === o)).filter(Boolean).map((o) => ({
      ...o,
      position: "left"
    })), M(r.options, "debugRows", "getLeftVisibleCells")), e.getRightVisibleCells = $(() => [e._getAllVisibleCells(), r.getState().columnPinning.right], (t, n) => (n ?? []).map((o) => t.find((s) => s.column.id === o)).filter(Boolean).map((o) => ({
      ...o,
      position: "right"
    })), M(r.options, "debugRows", "getRightVisibleCells"));
  },
  createTable: (e) => {
    e.setColumnPinning = (r) => e.options.onColumnPinningChange == null ? void 0 : e.options.onColumnPinningChange(r), e.resetColumnPinning = (r) => {
      var t, n;
      return e.setColumnPinning(r ? Ne() : (t = (n = e.initialState) == null ? void 0 : n.columnPinning) != null ? t : Ne());
    }, e.getIsSomeColumnsPinned = (r) => {
      var t;
      const n = e.getState().columnPinning;
      if (!r) {
        var i, o;
        return !!((i = n.left) != null && i.length || (o = n.right) != null && o.length);
      }
      return !!((t = n[r]) != null && t.length);
    }, e.getLeftLeafColumns = $(() => [e.getAllLeafColumns(), e.getState().columnPinning.left], (r, t) => (t ?? []).map((n) => r.find((i) => i.id === n)).filter(Boolean), M(e.options, "debugColumns", "getLeftLeafColumns")), e.getRightLeafColumns = $(() => [e.getAllLeafColumns(), e.getState().columnPinning.right], (r, t) => (t ?? []).map((n) => r.find((i) => i.id === n)).filter(Boolean), M(e.options, "debugColumns", "getRightLeafColumns")), e.getCenterLeafColumns = $(() => [e.getAllLeafColumns(), e.getState().columnPinning.left, e.getState().columnPinning.right], (r, t, n) => {
      const i = [...t ?? [], ...n ?? []];
      return r.filter((o) => !i.includes(o.id));
    }, M(e.options, "debugColumns", "getCenterLeafColumns"));
  }
};
function _n(e) {
  return e || (typeof document < "u" ? document : null);
}
const Ae = {
  size: 150,
  minSize: 20,
  maxSize: Number.MAX_SAFE_INTEGER
}, je = () => ({
  startOffset: null,
  startSize: null,
  deltaOffset: null,
  deltaPercentage: null,
  isResizingColumn: !1,
  columnSizingStart: []
}), Rn = {
  getDefaultColumnDef: () => Ae,
  getInitialState: (e) => ({
    columnSizing: {},
    columnSizingInfo: je(),
    ...e
  }),
  getDefaultOptions: (e) => ({
    columnResizeMode: "onEnd",
    columnResizeDirection: "ltr",
    onColumnSizingChange: de("columnSizing", e),
    onColumnSizingInfoChange: de("columnSizingInfo", e)
  }),
  createColumn: (e, r) => {
    e.getSize = () => {
      var t, n, i;
      const o = r.getState().columnSizing[e.id];
      return Math.min(Math.max((t = e.columnDef.minSize) != null ? t : Ae.minSize, (n = o ?? e.columnDef.size) != null ? n : Ae.size), (i = e.columnDef.maxSize) != null ? i : Ae.maxSize);
    }, e.getStart = $((t) => [t, Me(r, t), r.getState().columnSizing], (t, n) => n.slice(0, e.getIndex(t)).reduce((i, o) => i + o.getSize(), 0), M(r.options, "debugColumns", "getStart")), e.getAfter = $((t) => [t, Me(r, t), r.getState().columnSizing], (t, n) => n.slice(e.getIndex(t) + 1).reduce((i, o) => i + o.getSize(), 0), M(r.options, "debugColumns", "getAfter")), e.resetSize = () => {
      r.setColumnSizing((t) => {
        let {
          [e.id]: n,
          ...i
        } = t;
        return i;
      });
    }, e.getCanResize = () => {
      var t, n;
      return ((t = e.columnDef.enableResizing) != null ? t : !0) && ((n = r.options.enableColumnResizing) != null ? n : !0);
    }, e.getIsResizing = () => r.getState().columnSizingInfo.isResizingColumn === e.id;
  },
  createHeader: (e, r) => {
    e.getSize = () => {
      let t = 0;
      const n = (i) => {
        if (i.subHeaders.length)
          i.subHeaders.forEach(n);
        else {
          var o;
          t += (o = i.column.getSize()) != null ? o : 0;
        }
      };
      return n(e), t;
    }, e.getStart = () => {
      if (e.index > 0) {
        const t = e.headerGroup.headers[e.index - 1];
        return t.getStart() + t.getSize();
      }
      return 0;
    }, e.getResizeHandler = (t) => {
      const n = r.getColumn(e.column.id), i = n == null ? void 0 : n.getCanResize();
      return (o) => {
        if (!n || !i || (o.persist == null || o.persist(), qe(o) && o.touches && o.touches.length > 1))
          return;
        const s = e.getSize(), u = e ? e.getLeafHeaders().map((I) => [I.column.id, I.column.getSize()]) : [[n.id, n.getSize()]], a = qe(o) ? Math.round(o.touches[0].clientX) : o.clientX, l = {}, g = (I, H) => {
          typeof H == "number" && (r.setColumnSizingInfo((_) => {
            var k, A;
            const T = r.options.columnResizeDirection === "rtl" ? -1 : 1, z = (H - ((k = _ == null ? void 0 : _.startOffset) != null ? k : 0)) * T, d = Math.max(z / ((A = _ == null ? void 0 : _.startSize) != null ? A : 0), -0.999999);
            return _.columnSizingStart.forEach((c) => {
              let [m, w] = c;
              l[m] = Math.round(Math.max(w + w * d, 0) * 100) / 100;
            }), {
              ..._,
              deltaOffset: z,
              deltaPercentage: d
            };
          }), (r.options.columnResizeMode === "onChange" || I === "end") && r.setColumnSizing((_) => ({
            ..._,
            ...l
          })));
        }, S = (I) => g("move", I), p = (I) => {
          g("end", I), r.setColumnSizingInfo((H) => ({
            ...H,
            isResizingColumn: !1,
            startOffset: null,
            startSize: null,
            deltaOffset: null,
            deltaPercentage: null,
            columnSizingStart: []
          }));
        }, f = _n(t), h = {
          moveHandler: (I) => S(I.clientX),
          upHandler: (I) => {
            f == null || f.removeEventListener("mousemove", h.moveHandler), f == null || f.removeEventListener("mouseup", h.upHandler), p(I.clientX);
          }
        }, y = {
          moveHandler: (I) => (I.cancelable && (I.preventDefault(), I.stopPropagation()), S(I.touches[0].clientX), !1),
          upHandler: (I) => {
            var H;
            f == null || f.removeEventListener("touchmove", y.moveHandler), f == null || f.removeEventListener("touchend", y.upHandler), I.cancelable && (I.preventDefault(), I.stopPropagation()), p((H = I.touches[0]) == null ? void 0 : H.clientX);
          }
        }, F = xn() ? {
          passive: !1
        } : !1;
        qe(o) ? (f == null || f.addEventListener("touchmove", y.moveHandler, F), f == null || f.addEventListener("touchend", y.upHandler, F)) : (f == null || f.addEventListener("mousemove", h.moveHandler, F), f == null || f.addEventListener("mouseup", h.upHandler, F)), r.setColumnSizingInfo((I) => ({
          ...I,
          startOffset: a,
          startSize: s,
          deltaOffset: 0,
          deltaPercentage: 0,
          columnSizingStart: u,
          isResizingColumn: n.id
        }));
      };
    };
  },
  createTable: (e) => {
    e.setColumnSizing = (r) => e.options.onColumnSizingChange == null ? void 0 : e.options.onColumnSizingChange(r), e.setColumnSizingInfo = (r) => e.options.onColumnSizingInfoChange == null ? void 0 : e.options.onColumnSizingInfoChange(r), e.resetColumnSizing = (r) => {
      var t;
      e.setColumnSizing(r ? {} : (t = e.initialState.columnSizing) != null ? t : {});
    }, e.resetHeaderSizeInfo = (r) => {
      var t;
      e.setColumnSizingInfo(r ? je() : (t = e.initialState.columnSizingInfo) != null ? t : je());
    }, e.getTotalSize = () => {
      var r, t;
      return (r = (t = e.getHeaderGroups()[0]) == null ? void 0 : t.headers.reduce((n, i) => n + i.getSize(), 0)) != null ? r : 0;
    }, e.getLeftTotalSize = () => {
      var r, t;
      return (r = (t = e.getLeftHeaderGroups()[0]) == null ? void 0 : t.headers.reduce((n, i) => n + i.getSize(), 0)) != null ? r : 0;
    }, e.getCenterTotalSize = () => {
      var r, t;
      return (r = (t = e.getCenterHeaderGroups()[0]) == null ? void 0 : t.headers.reduce((n, i) => n + i.getSize(), 0)) != null ? r : 0;
    }, e.getRightTotalSize = () => {
      var r, t;
      return (r = (t = e.getRightHeaderGroups()[0]) == null ? void 0 : t.headers.reduce((n, i) => n + i.getSize(), 0)) != null ? r : 0;
    };
  }
};
let be = null;
function xn() {
  if (typeof be == "boolean") return be;
  let e = !1;
  try {
    const r = {
      get passive() {
        return e = !0, !1;
      }
    }, t = () => {
    };
    window.addEventListener("test", t, r), window.removeEventListener("test", t);
  } catch {
    e = !1;
  }
  return be = e, be;
}
function qe(e) {
  return e.type === "touchstart";
}
const kn = {
  getInitialState: (e) => ({
    columnVisibility: {},
    ...e
  }),
  getDefaultOptions: (e) => ({
    onColumnVisibilityChange: de("columnVisibility", e)
  }),
  createColumn: (e, r) => {
    e.toggleVisibility = (t) => {
      e.getCanHide() && r.setColumnVisibility((n) => ({
        ...n,
        [e.id]: t ?? !e.getIsVisible()
      }));
    }, e.getIsVisible = () => {
      var t, n;
      const i = e.columns;
      return (t = i.length ? i.some((o) => o.getIsVisible()) : (n = r.getState().columnVisibility) == null ? void 0 : n[e.id]) != null ? t : !0;
    }, e.getCanHide = () => {
      var t, n;
      return ((t = e.columnDef.enableHiding) != null ? t : !0) && ((n = r.options.enableHiding) != null ? n : !0);
    }, e.getToggleVisibilityHandler = () => (t) => {
      e.toggleVisibility == null || e.toggleVisibility(t.target.checked);
    };
  },
  createRow: (e, r) => {
    e._getAllVisibleCells = $(() => [e.getAllCells(), r.getState().columnVisibility], (t) => t.filter((n) => n.column.getIsVisible()), M(r.options, "debugRows", "_getAllVisibleCells")), e.getVisibleCells = $(() => [e.getLeftVisibleCells(), e.getCenterVisibleCells(), e.getRightVisibleCells()], (t, n, i) => [...t, ...n, ...i], M(r.options, "debugRows", "getVisibleCells"));
  },
  createTable: (e) => {
    const r = (t, n) => $(() => [n(), n().filter((i) => i.getIsVisible()).map((i) => i.id).join("_")], (i) => i.filter((o) => o.getIsVisible == null ? void 0 : o.getIsVisible()), M(e.options, "debugColumns", t));
    e.getVisibleFlatColumns = r("getVisibleFlatColumns", () => e.getAllFlatColumns()), e.getVisibleLeafColumns = r("getVisibleLeafColumns", () => e.getAllLeafColumns()), e.getLeftVisibleLeafColumns = r("getLeftVisibleLeafColumns", () => e.getLeftLeafColumns()), e.getRightVisibleLeafColumns = r("getRightVisibleLeafColumns", () => e.getRightLeafColumns()), e.getCenterVisibleLeafColumns = r("getCenterVisibleLeafColumns", () => e.getCenterLeafColumns()), e.setColumnVisibility = (t) => e.options.onColumnVisibilityChange == null ? void 0 : e.options.onColumnVisibilityChange(t), e.resetColumnVisibility = (t) => {
      var n;
      e.setColumnVisibility(t ? {} : (n = e.initialState.columnVisibility) != null ? n : {});
    }, e.toggleAllColumnsVisible = (t) => {
      var n;
      t = (n = t) != null ? n : !e.getIsAllColumnsVisible(), e.setColumnVisibility(e.getAllLeafColumns().reduce((i, o) => ({
        ...i,
        [o.id]: t || !(o.getCanHide != null && o.getCanHide())
      }), {}));
    }, e.getIsAllColumnsVisible = () => !e.getAllLeafColumns().some((t) => !(t.getIsVisible != null && t.getIsVisible())), e.getIsSomeColumnsVisible = () => e.getAllLeafColumns().some((t) => t.getIsVisible == null ? void 0 : t.getIsVisible()), e.getToggleAllColumnsVisibilityHandler = () => (t) => {
      var n;
      e.toggleAllColumnsVisible((n = t.target) == null ? void 0 : n.checked);
    };
  }
};
function Me(e, r) {
  return r ? r === "center" ? e.getCenterVisibleLeafColumns() : r === "left" ? e.getLeftVisibleLeafColumns() : e.getRightVisibleLeafColumns() : e.getVisibleLeafColumns();
}
const Fn = {
  createTable: (e) => {
    e._getGlobalFacetedRowModel = e.options.getFacetedRowModel && e.options.getFacetedRowModel(e, "__global__"), e.getGlobalFacetedRowModel = () => e.options.manualFiltering || !e._getGlobalFacetedRowModel ? e.getPreFilteredRowModel() : e._getGlobalFacetedRowModel(), e._getGlobalFacetedUniqueValues = e.options.getFacetedUniqueValues && e.options.getFacetedUniqueValues(e, "__global__"), e.getGlobalFacetedUniqueValues = () => e._getGlobalFacetedUniqueValues ? e._getGlobalFacetedUniqueValues() : /* @__PURE__ */ new Map(), e._getGlobalFacetedMinMaxValues = e.options.getFacetedMinMaxValues && e.options.getFacetedMinMaxValues(e, "__global__"), e.getGlobalFacetedMinMaxValues = () => {
      if (e._getGlobalFacetedMinMaxValues)
        return e._getGlobalFacetedMinMaxValues();
    };
  }
}, En = {
  getInitialState: (e) => ({
    globalFilter: void 0,
    ...e
  }),
  getDefaultOptions: (e) => ({
    onGlobalFilterChange: de("globalFilter", e),
    globalFilterFn: "auto",
    getColumnCanGlobalFilter: (r) => {
      var t;
      const n = (t = e.getCoreRowModel().flatRows[0]) == null || (t = t._getAllCellsByColumnId()[r.id]) == null ? void 0 : t.getValue();
      return typeof n == "string" || typeof n == "number";
    }
  }),
  createColumn: (e, r) => {
    e.getCanGlobalFilter = () => {
      var t, n, i, o;
      return ((t = e.columnDef.enableGlobalFilter) != null ? t : !0) && ((n = r.options.enableGlobalFilter) != null ? n : !0) && ((i = r.options.enableFilters) != null ? i : !0) && ((o = r.options.getColumnCanGlobalFilter == null ? void 0 : r.options.getColumnCanGlobalFilter(e)) != null ? o : !0) && !!e.accessorFn;
    };
  },
  createTable: (e) => {
    e.getGlobalAutoFilterFn = () => Se.includesString, e.getGlobalFilterFn = () => {
      var r, t;
      const {
        globalFilterFn: n
      } = e.options;
      return He(n) ? n : n === "auto" ? e.getGlobalAutoFilterFn() : (r = (t = e.options.filterFns) == null ? void 0 : t[n]) != null ? r : Se[n];
    }, e.setGlobalFilter = (r) => {
      e.options.onGlobalFilterChange == null || e.options.onGlobalFilterChange(r);
    }, e.resetGlobalFilter = (r) => {
      e.setGlobalFilter(r ? void 0 : e.initialState.globalFilter);
    };
  }
}, In = {
  getInitialState: (e) => ({
    expanded: {},
    ...e
  }),
  getDefaultOptions: (e) => ({
    onExpandedChange: de("expanded", e),
    paginateExpandedRows: !0
  }),
  createTable: (e) => {
    let r = !1, t = !1;
    e._autoResetExpanded = () => {
      var n, i;
      if (!r) {
        e._queue(() => {
          r = !0;
        });
        return;
      }
      if ((n = (i = e.options.autoResetAll) != null ? i : e.options.autoResetExpanded) != null ? n : !e.options.manualExpanding) {
        if (t) return;
        t = !0, e._queue(() => {
          e.resetExpanded(), t = !1;
        });
      }
    }, e.setExpanded = (n) => e.options.onExpandedChange == null ? void 0 : e.options.onExpandedChange(n), e.toggleAllRowsExpanded = (n) => {
      n ?? !e.getIsAllRowsExpanded() ? e.setExpanded(!0) : e.setExpanded({});
    }, e.resetExpanded = (n) => {
      var i, o;
      e.setExpanded(n ? {} : (i = (o = e.initialState) == null ? void 0 : o.expanded) != null ? i : {});
    }, e.getCanSomeRowsExpand = () => e.getPrePaginationRowModel().flatRows.some((n) => n.getCanExpand()), e.getToggleAllRowsExpandedHandler = () => (n) => {
      n.persist == null || n.persist(), e.toggleAllRowsExpanded();
    }, e.getIsSomeRowsExpanded = () => {
      const n = e.getState().expanded;
      return n === !0 || Object.values(n).some(Boolean);
    }, e.getIsAllRowsExpanded = () => {
      const n = e.getState().expanded;
      return typeof n == "boolean" ? n === !0 : !(!Object.keys(n).length || e.getRowModel().flatRows.some((i) => !i.getIsExpanded()));
    }, e.getExpandedDepth = () => {
      let n = 0;
      return (e.getState().expanded === !0 ? Object.keys(e.getRowModel().rowsById) : Object.keys(e.getState().expanded)).forEach((o) => {
        const s = o.split(".");
        n = Math.max(n, s.length);
      }), n;
    }, e.getPreExpandedRowModel = () => e.getSortedRowModel(), e.getExpandedRowModel = () => (!e._getExpandedRowModel && e.options.getExpandedRowModel && (e._getExpandedRowModel = e.options.getExpandedRowModel(e)), e.options.manualExpanding || !e._getExpandedRowModel ? e.getPreExpandedRowModel() : e._getExpandedRowModel());
  },
  createRow: (e, r) => {
    e.toggleExpanded = (t) => {
      r.setExpanded((n) => {
        var i;
        const o = n === !0 ? !0 : !!(n != null && n[e.id]);
        let s = {};
        if (n === !0 ? Object.keys(r.getRowModel().rowsById).forEach((u) => {
          s[u] = !0;
        }) : s = n, t = (i = t) != null ? i : !o, !o && t)
          return {
            ...s,
            [e.id]: !0
          };
        if (o && !t) {
          const {
            [e.id]: u,
            ...a
          } = s;
          return a;
        }
        return n;
      });
    }, e.getIsExpanded = () => {
      var t;
      const n = r.getState().expanded;
      return !!((t = r.options.getIsRowExpanded == null ? void 0 : r.options.getIsRowExpanded(e)) != null ? t : n === !0 || n != null && n[e.id]);
    }, e.getCanExpand = () => {
      var t, n, i;
      return (t = r.options.getRowCanExpand == null ? void 0 : r.options.getRowCanExpand(e)) != null ? t : ((n = r.options.enableExpanding) != null ? n : !0) && !!((i = e.subRows) != null && i.length);
    }, e.getIsAllParentsExpanded = () => {
      let t = !0, n = e;
      for (; t && n.parentId; )
        n = r.getRow(n.parentId, !0), t = n.getIsExpanded();
      return t;
    }, e.getToggleExpandedHandler = () => {
      const t = e.getCanExpand();
      return () => {
        t && e.toggleExpanded();
      };
    };
  }
}, Ze = 0, et = 10, We = () => ({
  pageIndex: Ze,
  pageSize: et
}), $n = {
  getInitialState: (e) => ({
    ...e,
    pagination: {
      ...We(),
      ...e == null ? void 0 : e.pagination
    }
  }),
  getDefaultOptions: (e) => ({
    onPaginationChange: de("pagination", e)
  }),
  createTable: (e) => {
    let r = !1, t = !1;
    e._autoResetPageIndex = () => {
      var n, i;
      if (!r) {
        e._queue(() => {
          r = !0;
        });
        return;
      }
      if ((n = (i = e.options.autoResetAll) != null ? i : e.options.autoResetPageIndex) != null ? n : !e.options.manualPagination) {
        if (t) return;
        t = !0, e._queue(() => {
          e.resetPageIndex(), t = !1;
        });
      }
    }, e.setPagination = (n) => {
      const i = (o) => we(n, o);
      return e.options.onPaginationChange == null ? void 0 : e.options.onPaginationChange(i);
    }, e.resetPagination = (n) => {
      var i;
      e.setPagination(n ? We() : (i = e.initialState.pagination) != null ? i : We());
    }, e.setPageIndex = (n) => {
      e.setPagination((i) => {
        let o = we(n, i.pageIndex);
        const s = typeof e.options.pageCount > "u" || e.options.pageCount === -1 ? Number.MAX_SAFE_INTEGER : e.options.pageCount - 1;
        return o = Math.max(0, Math.min(o, s)), {
          ...i,
          pageIndex: o
        };
      });
    }, e.resetPageIndex = (n) => {
      var i, o;
      e.setPageIndex(n ? Ze : (i = (o = e.initialState) == null || (o = o.pagination) == null ? void 0 : o.pageIndex) != null ? i : Ze);
    }, e.resetPageSize = (n) => {
      var i, o;
      e.setPageSize(n ? et : (i = (o = e.initialState) == null || (o = o.pagination) == null ? void 0 : o.pageSize) != null ? i : et);
    }, e.setPageSize = (n) => {
      e.setPagination((i) => {
        const o = Math.max(1, we(n, i.pageSize)), s = i.pageSize * i.pageIndex, u = Math.floor(s / o);
        return {
          ...i,
          pageIndex: u,
          pageSize: o
        };
      });
    }, e.setPageCount = (n) => e.setPagination((i) => {
      var o;
      let s = we(n, (o = e.options.pageCount) != null ? o : -1);
      return typeof s == "number" && (s = Math.max(-1, s)), {
        ...i,
        pageCount: s
      };
    }), e.getPageOptions = $(() => [e.getPageCount()], (n) => {
      let i = [];
      return n && n > 0 && (i = [...new Array(n)].fill(null).map((o, s) => s)), i;
    }, M(e.options, "debugTable", "getPageOptions")), e.getCanPreviousPage = () => e.getState().pagination.pageIndex > 0, e.getCanNextPage = () => {
      const {
        pageIndex: n
      } = e.getState().pagination, i = e.getPageCount();
      return i === -1 ? !0 : i === 0 ? !1 : n < i - 1;
    }, e.previousPage = () => e.setPageIndex((n) => n - 1), e.nextPage = () => e.setPageIndex((n) => n + 1), e.firstPage = () => e.setPageIndex(0), e.lastPage = () => e.setPageIndex(e.getPageCount() - 1), e.getPrePaginationRowModel = () => e.getExpandedRowModel(), e.getPaginationRowModel = () => (!e._getPaginationRowModel && e.options.getPaginationRowModel && (e._getPaginationRowModel = e.options.getPaginationRowModel(e)), e.options.manualPagination || !e._getPaginationRowModel ? e.getPrePaginationRowModel() : e._getPaginationRowModel()), e.getPageCount = () => {
      var n;
      return (n = e.options.pageCount) != null ? n : Math.ceil(e.getRowCount() / e.getState().pagination.pageSize);
    }, e.getRowCount = () => {
      var n;
      return (n = e.options.rowCount) != null ? n : e.getPrePaginationRowModel().rows.length;
    };
  }
}, Ke = () => ({
  top: [],
  bottom: []
}), Mn = {
  getInitialState: (e) => ({
    rowPinning: Ke(),
    ...e
  }),
  getDefaultOptions: (e) => ({
    onRowPinningChange: de("rowPinning", e)
  }),
  createRow: (e, r) => {
    e.pin = (t, n, i) => {
      const o = n ? e.getLeafRows().map((a) => {
        let {
          id: l
        } = a;
        return l;
      }) : [], s = i ? e.getParentRows().map((a) => {
        let {
          id: l
        } = a;
        return l;
      }) : [], u = /* @__PURE__ */ new Set([...s, e.id, ...o]);
      r.setRowPinning((a) => {
        var l, g;
        if (t === "bottom") {
          var S, p;
          return {
            top: ((S = a == null ? void 0 : a.top) != null ? S : []).filter((y) => !(u != null && u.has(y))),
            bottom: [...((p = a == null ? void 0 : a.bottom) != null ? p : []).filter((y) => !(u != null && u.has(y))), ...Array.from(u)]
          };
        }
        if (t === "top") {
          var f, h;
          return {
            top: [...((f = a == null ? void 0 : a.top) != null ? f : []).filter((y) => !(u != null && u.has(y))), ...Array.from(u)],
            bottom: ((h = a == null ? void 0 : a.bottom) != null ? h : []).filter((y) => !(u != null && u.has(y)))
          };
        }
        return {
          top: ((l = a == null ? void 0 : a.top) != null ? l : []).filter((y) => !(u != null && u.has(y))),
          bottom: ((g = a == null ? void 0 : a.bottom) != null ? g : []).filter((y) => !(u != null && u.has(y)))
        };
      });
    }, e.getCanPin = () => {
      var t;
      const {
        enableRowPinning: n,
        enablePinning: i
      } = r.options;
      return typeof n == "function" ? n(e) : (t = n ?? i) != null ? t : !0;
    }, e.getIsPinned = () => {
      const t = [e.id], {
        top: n,
        bottom: i
      } = r.getState().rowPinning, o = t.some((u) => n == null ? void 0 : n.includes(u)), s = t.some((u) => i == null ? void 0 : i.includes(u));
      return o ? "top" : s ? "bottom" : !1;
    }, e.getPinnedIndex = () => {
      var t, n;
      const i = e.getIsPinned();
      if (!i) return -1;
      const o = (t = i === "top" ? r.getTopRows() : r.getBottomRows()) == null ? void 0 : t.map((s) => {
        let {
          id: u
        } = s;
        return u;
      });
      return (n = o == null ? void 0 : o.indexOf(e.id)) != null ? n : -1;
    };
  },
  createTable: (e) => {
    e.setRowPinning = (r) => e.options.onRowPinningChange == null ? void 0 : e.options.onRowPinningChange(r), e.resetRowPinning = (r) => {
      var t, n;
      return e.setRowPinning(r ? Ke() : (t = (n = e.initialState) == null ? void 0 : n.rowPinning) != null ? t : Ke());
    }, e.getIsSomeRowsPinned = (r) => {
      var t;
      const n = e.getState().rowPinning;
      if (!r) {
        var i, o;
        return !!((i = n.top) != null && i.length || (o = n.bottom) != null && o.length);
      }
      return !!((t = n[r]) != null && t.length);
    }, e._getPinnedRows = (r, t, n) => {
      var i;
      return ((i = e.options.keepPinnedRows) == null || i ? (
        //get all rows that are pinned even if they would not be otherwise visible
        //account for expanded parent rows, but not pagination or filtering
        (t ?? []).map((s) => {
          const u = e.getRow(s, !0);
          return u.getIsAllParentsExpanded() ? u : null;
        })
      ) : (
        //else get only visible rows that are pinned
        (t ?? []).map((s) => r.find((u) => u.id === s))
      )).filter(Boolean).map((s) => ({
        ...s,
        position: n
      }));
    }, e.getTopRows = $(() => [e.getRowModel().rows, e.getState().rowPinning.top], (r, t) => e._getPinnedRows(r, t, "top"), M(e.options, "debugRows", "getTopRows")), e.getBottomRows = $(() => [e.getRowModel().rows, e.getState().rowPinning.bottom], (r, t) => e._getPinnedRows(r, t, "bottom"), M(e.options, "debugRows", "getBottomRows")), e.getCenterRows = $(() => [e.getRowModel().rows, e.getState().rowPinning.top, e.getState().rowPinning.bottom], (r, t, n) => {
      const i = /* @__PURE__ */ new Set([...t ?? [], ...n ?? []]);
      return r.filter((o) => !i.has(o.id));
    }, M(e.options, "debugRows", "getCenterRows"));
  }
}, Pn = {
  getInitialState: (e) => ({
    rowSelection: {},
    ...e
  }),
  getDefaultOptions: (e) => ({
    onRowSelectionChange: de("rowSelection", e),
    enableRowSelection: !0,
    enableMultiRowSelection: !0,
    enableSubRowSelection: !0
    // enableGroupingRowSelection: false,
    // isAdditiveSelectEvent: (e: unknown) => !!e.metaKey,
    // isInclusiveSelectEvent: (e: unknown) => !!e.shiftKey,
  }),
  createTable: (e) => {
    e.setRowSelection = (r) => e.options.onRowSelectionChange == null ? void 0 : e.options.onRowSelectionChange(r), e.resetRowSelection = (r) => {
      var t;
      return e.setRowSelection(r ? {} : (t = e.initialState.rowSelection) != null ? t : {});
    }, e.toggleAllRowsSelected = (r) => {
      e.setRowSelection((t) => {
        r = typeof r < "u" ? r : !e.getIsAllRowsSelected();
        const n = {
          ...t
        }, i = e.getPreGroupedRowModel().flatRows;
        return r ? i.forEach((o) => {
          o.getCanSelect() && (n[o.id] = !0);
        }) : i.forEach((o) => {
          delete n[o.id];
        }), n;
      });
    }, e.toggleAllPageRowsSelected = (r) => e.setRowSelection((t) => {
      const n = typeof r < "u" ? r : !e.getIsAllPageRowsSelected(), i = {
        ...t
      };
      return e.getRowModel().rows.forEach((o) => {
        tt(i, o.id, n, !0, e);
      }), i;
    }), e.getPreSelectedRowModel = () => e.getCoreRowModel(), e.getSelectedRowModel = $(() => [e.getState().rowSelection, e.getCoreRowModel()], (r, t) => Object.keys(r).length ? Xe(e, t) : {
      rows: [],
      flatRows: [],
      rowsById: {}
    }, M(e.options, "debugTable", "getSelectedRowModel")), e.getFilteredSelectedRowModel = $(() => [e.getState().rowSelection, e.getFilteredRowModel()], (r, t) => Object.keys(r).length ? Xe(e, t) : {
      rows: [],
      flatRows: [],
      rowsById: {}
    }, M(e.options, "debugTable", "getFilteredSelectedRowModel")), e.getGroupedSelectedRowModel = $(() => [e.getState().rowSelection, e.getSortedRowModel()], (r, t) => Object.keys(r).length ? Xe(e, t) : {
      rows: [],
      flatRows: [],
      rowsById: {}
    }, M(e.options, "debugTable", "getGroupedSelectedRowModel")), e.getIsAllRowsSelected = () => {
      const r = e.getFilteredRowModel().flatRows, {
        rowSelection: t
      } = e.getState();
      let n = !!(r.length && Object.keys(t).length);
      return n && r.some((i) => i.getCanSelect() && !t[i.id]) && (n = !1), n;
    }, e.getIsAllPageRowsSelected = () => {
      const r = e.getPaginationRowModel().flatRows.filter((i) => i.getCanSelect()), {
        rowSelection: t
      } = e.getState();
      let n = !!r.length;
      return n && r.some((i) => !t[i.id]) && (n = !1), n;
    }, e.getIsSomeRowsSelected = () => {
      var r;
      const t = Object.keys((r = e.getState().rowSelection) != null ? r : {}).length;
      return t > 0 && t < e.getFilteredRowModel().flatRows.length;
    }, e.getIsSomePageRowsSelected = () => {
      const r = e.getPaginationRowModel().flatRows;
      return e.getIsAllPageRowsSelected() ? !1 : r.filter((t) => t.getCanSelect()).some((t) => t.getIsSelected() || t.getIsSomeSelected());
    }, e.getToggleAllRowsSelectedHandler = () => (r) => {
      e.toggleAllRowsSelected(r.target.checked);
    }, e.getToggleAllPageRowsSelectedHandler = () => (r) => {
      e.toggleAllPageRowsSelected(r.target.checked);
    };
  },
  createRow: (e, r) => {
    e.toggleSelected = (t, n) => {
      const i = e.getIsSelected();
      r.setRowSelection((o) => {
        var s;
        if (t = typeof t < "u" ? t : !i, e.getCanSelect() && i === t)
          return o;
        const u = {
          ...o
        };
        return tt(u, e.id, t, (s = n == null ? void 0 : n.selectChildren) != null ? s : !0, r), u;
      });
    }, e.getIsSelected = () => {
      const {
        rowSelection: t
      } = r.getState();
      return at(e, t);
    }, e.getIsSomeSelected = () => {
      const {
        rowSelection: t
      } = r.getState();
      return nt(e, t) === "some";
    }, e.getIsAllSubRowsSelected = () => {
      const {
        rowSelection: t
      } = r.getState();
      return nt(e, t) === "all";
    }, e.getCanSelect = () => {
      var t;
      return typeof r.options.enableRowSelection == "function" ? r.options.enableRowSelection(e) : (t = r.options.enableRowSelection) != null ? t : !0;
    }, e.getCanSelectSubRows = () => {
      var t;
      return typeof r.options.enableSubRowSelection == "function" ? r.options.enableSubRowSelection(e) : (t = r.options.enableSubRowSelection) != null ? t : !0;
    }, e.getCanMultiSelect = () => {
      var t;
      return typeof r.options.enableMultiRowSelection == "function" ? r.options.enableMultiRowSelection(e) : (t = r.options.enableMultiRowSelection) != null ? t : !0;
    }, e.getToggleSelectedHandler = () => {
      const t = e.getCanSelect();
      return (n) => {
        var i;
        t && e.toggleSelected((i = n.target) == null ? void 0 : i.checked);
      };
    };
  }
}, tt = (e, r, t, n, i) => {
  var o;
  const s = i.getRow(r, !0);
  t ? (s.getCanMultiSelect() || Object.keys(e).forEach((u) => delete e[u]), s.getCanSelect() && (e[r] = !0)) : delete e[r], n && (o = s.subRows) != null && o.length && s.getCanSelectSubRows() && s.subRows.forEach((u) => tt(e, u.id, t, n, i));
};
function Xe(e, r) {
  const t = e.getState().rowSelection, n = [], i = {}, o = function(s, u) {
    return s.map((a) => {
      var l;
      const g = at(a, t);
      if (g && (n.push(a), i[a.id] = a), (l = a.subRows) != null && l.length && (a = {
        ...a,
        subRows: o(a.subRows)
      }), g)
        return a;
    }).filter(Boolean);
  };
  return {
    rows: o(r.rows),
    flatRows: n,
    rowsById: i
  };
}
function at(e, r) {
  var t;
  return (t = r[e.id]) != null ? t : !1;
}
function nt(e, r, t) {
  var n;
  if (!((n = e.subRows) != null && n.length)) return !1;
  let i = !0, o = !1;
  return e.subRows.forEach((s) => {
    if (!(o && !i) && (s.getCanSelect() && (at(s, r) ? o = !0 : i = !1), s.subRows && s.subRows.length)) {
      const u = nt(s, r);
      u === "all" ? o = !0 : (u === "some" && (o = !0), i = !1);
    }
  }), i ? "all" : o ? "some" : !1;
}
const rt = /([0-9]+)/gm, Vn = (e, r, t) => Pt(_e(e.getValue(t)).toLowerCase(), _e(r.getValue(t)).toLowerCase()), An = (e, r, t) => Pt(_e(e.getValue(t)), _e(r.getValue(t))), bn = (e, r, t) => ut(_e(e.getValue(t)).toLowerCase(), _e(r.getValue(t)).toLowerCase()), Dn = (e, r, t) => ut(_e(e.getValue(t)), _e(r.getValue(t))), Ln = (e, r, t) => {
  const n = e.getValue(t), i = r.getValue(t);
  return n > i ? 1 : n < i ? -1 : 0;
}, Tn = (e, r, t) => ut(e.getValue(t), r.getValue(t));
function ut(e, r) {
  return e === r ? 0 : e > r ? 1 : -1;
}
function _e(e) {
  return typeof e == "number" ? isNaN(e) || e === 1 / 0 || e === -1 / 0 ? "" : String(e) : typeof e == "string" ? e : "";
}
function Pt(e, r) {
  const t = e.split(rt).filter(Boolean), n = r.split(rt).filter(Boolean);
  for (; t.length && n.length; ) {
    const i = t.shift(), o = n.shift(), s = parseInt(i, 10), u = parseInt(o, 10), a = [s, u].sort();
    if (isNaN(a[0])) {
      if (i > o)
        return 1;
      if (o > i)
        return -1;
      continue;
    }
    if (isNaN(a[1]))
      return isNaN(s) ? -1 : 1;
    if (s > u)
      return 1;
    if (u > s)
      return -1;
  }
  return t.length - n.length;
}
const $e = {
  alphanumeric: Vn,
  alphanumericCaseSensitive: An,
  text: bn,
  textCaseSensitive: Dn,
  datetime: Ln,
  basic: Tn
}, On = {
  getInitialState: (e) => ({
    sorting: [],
    ...e
  }),
  getDefaultColumnDef: () => ({
    sortingFn: "auto",
    sortUndefined: 1
  }),
  getDefaultOptions: (e) => ({
    onSortingChange: de("sorting", e),
    isMultiSortEvent: (r) => r.shiftKey
  }),
  createColumn: (e, r) => {
    e.getAutoSortingFn = () => {
      const t = r.getFilteredRowModel().flatRows.slice(10);
      let n = !1;
      for (const i of t) {
        const o = i == null ? void 0 : i.getValue(e.id);
        if (Object.prototype.toString.call(o) === "[object Date]")
          return $e.datetime;
        if (typeof o == "string" && (n = !0, o.split(rt).length > 1))
          return $e.alphanumeric;
      }
      return n ? $e.text : $e.basic;
    }, e.getAutoSortDir = () => {
      const t = r.getFilteredRowModel().flatRows[0];
      return typeof (t == null ? void 0 : t.getValue(e.id)) == "string" ? "asc" : "desc";
    }, e.getSortingFn = () => {
      var t, n;
      if (!e)
        throw new Error();
      return He(e.columnDef.sortingFn) ? e.columnDef.sortingFn : e.columnDef.sortingFn === "auto" ? e.getAutoSortingFn() : (t = (n = r.options.sortingFns) == null ? void 0 : n[e.columnDef.sortingFn]) != null ? t : $e[e.columnDef.sortingFn];
    }, e.toggleSorting = (t, n) => {
      const i = e.getNextSortingOrder(), o = typeof t < "u" && t !== null;
      r.setSorting((s) => {
        const u = s == null ? void 0 : s.find((f) => f.id === e.id), a = s == null ? void 0 : s.findIndex((f) => f.id === e.id);
        let l = [], g, S = o ? t : i === "desc";
        if (s != null && s.length && e.getCanMultiSort() && n ? u ? g = "toggle" : g = "add" : s != null && s.length && a !== s.length - 1 ? g = "replace" : u ? g = "toggle" : g = "replace", g === "toggle" && (o || i || (g = "remove")), g === "add") {
          var p;
          l = [...s, {
            id: e.id,
            desc: S
          }], l.splice(0, l.length - ((p = r.options.maxMultiSortColCount) != null ? p : Number.MAX_SAFE_INTEGER));
        } else g === "toggle" ? l = s.map((f) => f.id === e.id ? {
          ...f,
          desc: S
        } : f) : g === "remove" ? l = s.filter((f) => f.id !== e.id) : l = [{
          id: e.id,
          desc: S
        }];
        return l;
      });
    }, e.getFirstSortDir = () => {
      var t, n;
      return ((t = (n = e.columnDef.sortDescFirst) != null ? n : r.options.sortDescFirst) != null ? t : e.getAutoSortDir() === "desc") ? "desc" : "asc";
    }, e.getNextSortingOrder = (t) => {
      var n, i;
      const o = e.getFirstSortDir(), s = e.getIsSorted();
      return s ? s !== o && ((n = r.options.enableSortingRemoval) == null || n) && // If enableSortRemove, enable in general
      (!(t && (i = r.options.enableMultiRemove) != null) || i) ? !1 : s === "desc" ? "asc" : "desc" : o;
    }, e.getCanSort = () => {
      var t, n;
      return ((t = e.columnDef.enableSorting) != null ? t : !0) && ((n = r.options.enableSorting) != null ? n : !0) && !!e.accessorFn;
    }, e.getCanMultiSort = () => {
      var t, n;
      return (t = (n = e.columnDef.enableMultiSort) != null ? n : r.options.enableMultiSort) != null ? t : !!e.accessorFn;
    }, e.getIsSorted = () => {
      var t;
      const n = (t = r.getState().sorting) == null ? void 0 : t.find((i) => i.id === e.id);
      return n ? n.desc ? "desc" : "asc" : !1;
    }, e.getSortIndex = () => {
      var t, n;
      return (t = (n = r.getState().sorting) == null ? void 0 : n.findIndex((i) => i.id === e.id)) != null ? t : -1;
    }, e.clearSorting = () => {
      r.setSorting((t) => t != null && t.length ? t.filter((n) => n.id !== e.id) : []);
    }, e.getToggleSortingHandler = () => {
      const t = e.getCanSort();
      return (n) => {
        t && (n.persist == null || n.persist(), e.toggleSorting == null || e.toggleSorting(void 0, e.getCanMultiSort() ? r.options.isMultiSortEvent == null ? void 0 : r.options.isMultiSortEvent(n) : !1));
      };
    };
  },
  createTable: (e) => {
    e.setSorting = (r) => e.options.onSortingChange == null ? void 0 : e.options.onSortingChange(r), e.resetSorting = (r) => {
      var t, n;
      e.setSorting(r ? [] : (t = (n = e.initialState) == null ? void 0 : n.sorting) != null ? t : []);
    }, e.getPreSortedRowModel = () => e.getGroupedRowModel(), e.getSortedRowModel = () => (!e._getSortedRowModel && e.options.getSortedRowModel && (e._getSortedRowModel = e.options.getSortedRowModel(e)), e.options.manualSorting || !e._getSortedRowModel ? e.getPreSortedRowModel() : e._getSortedRowModel());
  }
}, zn = [
  on,
  kn,
  yn,
  wn,
  ln,
  an,
  Fn,
  //depends on ColumnFaceting
  En,
  //depends on ColumnFiltering
  On,
  Sn,
  //depends on RowSorting
  In,
  $n,
  Mn,
  Pn,
  Rn
];
function Hn(e) {
  var r, t;
  process.env.NODE_ENV !== "production" && (e.debugAll || e.debugTable) && console.info("Creating Table Instance...");
  const n = [...zn, ...(r = e._features) != null ? r : []];
  let i = {
    _features: n
  };
  const o = i._features.reduce((p, f) => Object.assign(p, f.getDefaultOptions == null ? void 0 : f.getDefaultOptions(i)), {}), s = (p) => i.options.mergeOptions ? i.options.mergeOptions(o, p) : {
    ...o,
    ...p
  };
  let a = {
    ...{},
    ...(t = e.initialState) != null ? t : {}
  };
  i._features.forEach((p) => {
    var f;
    a = (f = p.getInitialState == null ? void 0 : p.getInitialState(a)) != null ? f : a;
  });
  const l = [];
  let g = !1;
  const S = {
    _features: n,
    options: {
      ...o,
      ...e
    },
    initialState: a,
    _queue: (p) => {
      l.push(p), g || (g = !0, Promise.resolve().then(() => {
        for (; l.length; )
          l.shift()();
        g = !1;
      }).catch((f) => setTimeout(() => {
        throw f;
      })));
    },
    reset: () => {
      i.setState(i.initialState);
    },
    setOptions: (p) => {
      const f = we(p, i.options);
      i.options = s(f);
    },
    getState: () => i.options.state,
    setState: (p) => {
      i.options.onStateChange == null || i.options.onStateChange(p);
    },
    _getRowId: (p, f, h) => {
      var y;
      return (y = i.options.getRowId == null ? void 0 : i.options.getRowId(p, f, h)) != null ? y : `${h ? [h.id, f].join(".") : f}`;
    },
    getCoreRowModel: () => (i._getCoreRowModel || (i._getCoreRowModel = i.options.getCoreRowModel(i)), i._getCoreRowModel()),
    // The final calls start at the bottom of the model,
    // expanded rows, which then work their way up
    getRowModel: () => i.getPaginationRowModel(),
    //in next version, we should just pass in the row model as the optional 2nd arg
    getRow: (p, f) => {
      let h = (f ? i.getPrePaginationRowModel() : i.getRowModel()).rowsById[p];
      if (!h && (h = i.getCoreRowModel().rowsById[p], !h))
        throw process.env.NODE_ENV !== "production" ? new Error(`getRow could not find row with ID: ${p}`) : new Error();
      return h;
    },
    _getDefaultColumnDef: $(() => [i.options.defaultColumn], (p) => {
      var f;
      return p = (f = p) != null ? f : {}, {
        header: (h) => {
          const y = h.header.column.columnDef;
          return y.accessorKey ? y.accessorKey : y.accessorFn ? y.id : null;
        },
        // footer: props => props.header.column.id,
        cell: (h) => {
          var y, F;
          return (y = (F = h.renderValue()) == null || F.toString == null ? void 0 : F.toString()) != null ? y : null;
        },
        ...i._features.reduce((h, y) => Object.assign(h, y.getDefaultColumnDef == null ? void 0 : y.getDefaultColumnDef()), {}),
        ...p
      };
    }, M(e, "debugColumns", "_getDefaultColumnDef")),
    _getColumnDefs: () => i.options.columns,
    getAllColumns: $(() => [i._getColumnDefs()], (p) => {
      const f = function(h, y, F) {
        return F === void 0 && (F = 0), h.map((I) => {
          const H = rn(i, I, F, y), _ = I;
          return H.columns = _.columns ? f(_.columns, H, F + 1) : [], H;
        });
      };
      return f(p);
    }, M(e, "debugColumns", "getAllColumns")),
    getAllFlatColumns: $(() => [i.getAllColumns()], (p) => p.flatMap((f) => f.getFlatColumns()), M(e, "debugColumns", "getAllFlatColumns")),
    _getAllFlatColumnsById: $(() => [i.getAllFlatColumns()], (p) => p.reduce((f, h) => (f[h.id] = h, f), {}), M(e, "debugColumns", "getAllFlatColumnsById")),
    getAllLeafColumns: $(() => [i.getAllColumns(), i._getOrderColumnsFn()], (p, f) => {
      let h = p.flatMap((y) => y.getLeafColumns());
      return f(h);
    }, M(e, "debugColumns", "getAllLeafColumns")),
    getColumn: (p) => {
      const f = i._getAllFlatColumnsById()[p];
      return process.env.NODE_ENV !== "production" && !f && console.error(`[Table] Column with id '${p}' does not exist.`), f;
    }
  };
  Object.assign(i, S);
  for (let p = 0; p < i._features.length; p++) {
    const f = i._features[p];
    f == null || f.createTable == null || f.createTable(i);
  }
  return i;
}
function Gn() {
  return (e) => $(() => [e.options.data], (r) => {
    const t = {
      rows: [],
      flatRows: [],
      rowsById: {}
    }, n = function(i, o, s) {
      o === void 0 && (o = 0);
      const u = [];
      for (let l = 0; l < i.length; l++) {
        const g = sn(e, e._getRowId(i[l], l, s), i[l], l, o, void 0, s == null ? void 0 : s.id);
        if (t.flatRows.push(g), t.rowsById[g.id] = g, u.push(g), e.options.getSubRows) {
          var a;
          g.originalSubRows = e.options.getSubRows(i[l], l), (a = g.originalSubRows) != null && a.length && (g.subRows = n(g.originalSubRows, o + 1, g));
        }
      }
      return u;
    };
    return t.rows = n(r), t;
  }, M(e.options, "debugTable", "getRowModel", () => e._autoResetPageIndex()));
}
function Bn() {
  return (e) => $(() => [e.getState().sorting, e.getPreSortedRowModel()], (r, t) => {
    if (!t.rows.length || !(r != null && r.length))
      return t;
    const n = e.getState().sorting, i = [], o = n.filter((a) => {
      var l;
      return (l = e.getColumn(a.id)) == null ? void 0 : l.getCanSort();
    }), s = {};
    o.forEach((a) => {
      const l = e.getColumn(a.id);
      l && (s[a.id] = {
        sortUndefined: l.columnDef.sortUndefined,
        invertSorting: l.columnDef.invertSorting,
        sortingFn: l.getSortingFn()
      });
    });
    const u = (a) => {
      const l = a.map((g) => ({
        ...g
      }));
      return l.sort((g, S) => {
        for (let f = 0; f < o.length; f += 1) {
          var p;
          const h = o[f], y = s[h.id], F = y.sortUndefined, I = (p = h == null ? void 0 : h.desc) != null ? p : !1;
          let H = 0;
          if (F) {
            const _ = g.getValue(h.id), k = S.getValue(h.id), A = _ === void 0, T = k === void 0;
            if (A || T) {
              if (F === "first") return A ? -1 : 1;
              if (F === "last") return A ? 1 : -1;
              H = A && T ? 0 : A ? F : -F;
            }
          }
          if (H === 0 && (H = y.sortingFn(g, S, h.id)), H !== 0)
            return I && (H *= -1), y.invertSorting && (H *= -1), H;
        }
        return g.index - S.index;
      }), l.forEach((g) => {
        var S;
        i.push(g), (S = g.subRows) != null && S.length && (g.subRows = u(g.subRows));
      }), l;
    };
    return {
      rows: u(t.rows),
      flatRows: i,
      rowsById: t.rowsById
    };
  }, M(e.options, "debugTable", "getSortedRowModel", () => e._autoResetPageIndex()));
}
/**
   * react-table
   *
   * Copyright (c) TanStack
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE.md file in the root directory of this source tree.
   *
   * @license MIT
   */
function pt(e, r) {
  return e ? Un(e) ? /* @__PURE__ */ Ye.createElement(e, r) : e : null;
}
function Un(e) {
  return Nn(e) || typeof e == "function" || jn(e);
}
function Nn(e) {
  return typeof e == "function" && (() => {
    const r = Object.getPrototypeOf(e);
    return r.prototype && r.prototype.isReactComponent;
  })();
}
function jn(e) {
  return typeof e == "object" && typeof e.$$typeof == "symbol" && ["react.memo", "react.forward_ref"].includes(e.$$typeof.description);
}
function qn(e) {
  const r = {
    state: {},
    // Dummy state
    onStateChange: () => {
    },
    // noop
    renderFallbackValue: null,
    ...e
  }, [t] = Ye.useState(() => ({
    current: Hn(r)
  })), [n, i] = Ye.useState(() => t.current.initialState);
  return t.current.setOptions((o) => ({
    ...o,
    ...e,
    state: {
      ...n,
      ...e.state
    },
    // Similarly, we'll maintain both our internal state and any user-provided
    // state.
    onStateChange: (s) => {
      i(s), e.onStateChange == null || e.onStateChange(s);
    }
  })), t.current;
}
function Fe({ variant: e, title: r, message: t, actionLabel: n, onAction: i }) {
  if (e === "loading")
    return /* @__PURE__ */ W(
      "div",
      {
        role: "status",
        "aria-live": "polite",
        style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-4)",
          padding: "var(--space-12) var(--space-6)"
        },
        children: [
          /* @__PURE__ */ v("div", { style: { width: "60%", maxWidth: 320 }, children: /* @__PURE__ */ v(zt, {}) }),
          t && /* @__PURE__ */ v("span", { style: { fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }, children: t })
        ]
      }
    );
  const o = e === "error";
  return /* @__PURE__ */ W(
    "div",
    {
      role: o ? "alert" : void 0,
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "var(--space-3)",
        padding: "var(--space-12) var(--space-6)",
        borderRadius: "var(--radius-lg)",
        border: o ? "1px solid var(--border-color)" : "2px dashed var(--border-color)",
        background: o ? "var(--bg-tertiary)" : "transparent",
        boxShadow: o ? "var(--shadow-xs)" : "none"
      },
      children: [
        r && /* @__PURE__ */ v(
          "h3",
          {
            style: {
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-xl)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--text-primary)"
            },
            children: r
          }
        ),
        t && /* @__PURE__ */ v("p", { style: { margin: 0, fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }, children: t }),
        n && i && /* @__PURE__ */ v(ae, { variant: "primary", onClick: i, children: n })
      ]
    }
  );
}
const mt = ["admin", "member", "viewer"];
function Wn({ value: e, callerRole: r, onChange: t, disabled: n }) {
  const { messages: i } = Ce(), o = n || r === "viewer" || e === "owner", s = (e === "owner" ? ["owner", ...mt] : mt).map((u) => ({
    value: u,
    label: i.roles[u]
  }));
  return /* @__PURE__ */ v(
    Le,
    {
      value: e,
      disabled: o,
      "aria-label": i.members.role,
      options: s,
      onChange: (u) => t(u.target.value)
    }
  );
}
const Kn = 24 * 60 * 60 * 1e3;
function Vt(e, r = Date.now()) {
  if (!e) return null;
  const t = new Date(e).getTime();
  return Number.isNaN(t) ? null : Math.floor((t - r) / Kn);
}
function Xn(e, r = 14, t = Date.now()) {
  const n = Vt(e, t);
  return n === null ? !1 : n >= 0 && n <= r;
}
function Jn(e, r = Date.now()) {
  const t = Vt(e, r);
  return t !== null && t < 0;
}
function Pe(e, r = "en") {
  if (!e) return null;
  const t = new Date(e);
  return Number.isNaN(t.getTime()) ? null : t.toLocaleDateString(r, { year: "numeric", month: "short", day: "numeric" });
}
const ke = Zt(), Qn = {
  active: "online",
  pending: "degraded",
  suspended: "offline"
};
function Je(e) {
  const { firstName: r, lastName: t, email: n } = e.user;
  return `${r ?? ""} ${t ?? ""}`.trim() || n;
}
const Yn = () => /* @__PURE__ */ v("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.6", "aria-hidden": "true", children: /* @__PURE__ */ v("path", { d: "M2.5 4h11M6 4V2.5h4V4M4 4l.5 9h7l.5-9", strokeLinecap: "round", strokeLinejoin: "round" }) });
function Zn({
  members: e,
  loading: r,
  error: t,
  userRole: n,
  onRoleChange: i,
  onRemove: o,
  onInvite: s,
  onRetry: u
}) {
  const { messages: a, locale: l } = Ce(), g = a.members, [S, p] = U([]), f = n === "owner" || n === "admin", h = Oe(
    () => [
      ke.accessor((_) => `${_.user.lastName ?? ""} ${_.user.firstName ?? ""}`, {
        id: "name",
        header: g.title,
        cell: (_) => /* @__PURE__ */ W("span", { style: { display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }, children: [
          /* @__PURE__ */ v(Ht, { name: Je(_.row.original), size: "sm" }),
          /* @__PURE__ */ v("span", { style: { fontFamily: "var(--font-display)", fontSize: "var(--text-sm)", color: "var(--text-primary)" }, children: Je(_.row.original) })
        ] })
      }),
      ke.accessor((_) => _.user.email, {
        id: "email",
        header: g.email,
        cell: (_) => /* @__PURE__ */ v("span", { style: { fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }, children: _.getValue() })
      }),
      ke.accessor("role", {
        id: "role",
        header: g.role,
        cell: (_) => {
          const k = _.row.original;
          return f && k.role !== "owner" ? /* @__PURE__ */ v(
            Wn,
            {
              value: k.role,
              callerRole: n,
              onChange: (A) => i(k.id, A)
            }
          ) : /* @__PURE__ */ v(ht, { role: k.role });
        }
      }),
      ke.accessor("status", {
        id: "status",
        header: g.status,
        enableSorting: !1,
        cell: (_) => /* @__PURE__ */ v(vt, { status: Qn[_.getValue()], label: g[`status${er(_.getValue())}`] })
      }),
      ke.accessor((_) => _.joined_at ?? "", {
        id: "joined",
        header: g.joined,
        cell: (_) => /* @__PURE__ */ v("span", { style: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }, children: Pe(_.getValue() || null, l) ?? "—" })
      }),
      ke.display({
        id: "actions",
        header: a.common.actions,
        cell: (_) => {
          const k = _.row.original;
          return !f || k.role === "owner" ? null : /* @__PURE__ */ v(Gt, { label: `${g.remove} ${Je(k)}`, size: "sm", onClick: () => o(k.id), children: /* @__PURE__ */ v(Yn, {}) });
        }
      })
    ],
    [f, n, l, g, a.common.actions, i, o]
  ), y = qn({
    data: e,
    columns: h,
    state: { sorting: S },
    onSortingChange: p,
    getCoreRowModel: Gn(),
    getSortedRowModel: Bn()
  });
  if (t)
    return /* @__PURE__ */ v(Fe, { variant: "error", title: g.errorTitle, message: t, actionLabel: a.common.retry, onAction: u });
  const F = S[0], I = y.getHeaderGroups()[0].headers.map((_) => ({
    key: _.column.id,
    header: pt(_.column.columnDef.header, _.getContext()),
    sortable: _.column.getCanSort(),
    align: _.column.id === "actions" ? "right" : "left"
  })), H = {
    padding: "var(--space-3) var(--space-4)",
    borderBottom: "1px solid var(--border-color)",
    verticalAlign: "middle"
  };
  return /* @__PURE__ */ v(
    ot,
    {
      columns: I,
      loading: r,
      sortBy: F == null ? void 0 : F.id,
      sortDir: F != null && F.desc ? "desc" : "asc",
      onSort: (_) => {
        const k = y.getColumn(_);
        k == null || k.toggleSorting();
      },
      emptyState: /* @__PURE__ */ v(
        Fe,
        {
          variant: "empty-members",
          title: g.emptyTitle,
          message: g.emptyBody,
          actionLabel: f ? g.invite : void 0,
          onAction: f ? s : void 0
        }
      ),
      children: e.length > 0 && /* @__PURE__ */ v("tbody", { children: y.getRowModel().rows.map((_) => /* @__PURE__ */ v("tr", { children: _.getVisibleCells().map((k) => /* @__PURE__ */ v("td", { style: { ...H, textAlign: k.column.id === "actions" ? "right" : "left" }, children: pt(k.column.columnDef.cell, k.getContext()) }, k.id)) }, _.id)) })
    }
  );
}
function er(e) {
  return e.charAt(0).toUpperCase() + e.slice(1);
}
function tr({
  invitations: e,
  loading: r,
  error: t,
  userRole: n,
  onResend: i,
  onRevoke: o,
  onRetry: s
}) {
  const { messages: u, locale: a } = Ce(), l = u.invitations, g = n === "owner" || n === "admin", [S, p] = U({}), [f, h] = U(/* @__PURE__ */ new Set()), y = [
    { key: "email", header: l.email },
    { key: "role", header: l.role },
    { key: "invited", header: l.invited },
    { key: "expires", header: l.expires },
    ...g ? [{ key: "actions", header: u.common.actions, align: "right" }] : []
  ];
  if (t)
    return /* @__PURE__ */ v(Fe, { variant: "error", message: t, actionLabel: u.common.retry, onAction: s });
  const F = e.filter((k) => !f.has(k.id));
  async function I(k) {
    p((A) => ({ ...A, [k]: "resend" }));
    try {
      await i(k);
    } finally {
      p((A) => {
        const T = { ...A };
        return delete T[k], T;
      });
    }
  }
  async function H(k) {
    p((A) => ({ ...A, [k]: "revoke" })), h((A) => new Set(A).add(k));
    try {
      await o(k);
    } catch {
      h((A) => {
        const T = new Set(A);
        return T.delete(k), T;
      });
    } finally {
      p((A) => {
        const T = { ...A };
        return delete T[k], T;
      });
    }
  }
  const _ = {
    padding: "var(--space-3) var(--space-4)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    color: "var(--text-primary)",
    borderBottom: "1px solid var(--border-color)",
    verticalAlign: "middle"
  };
  return /* @__PURE__ */ v(
    ot,
    {
      columns: y,
      loading: r,
      emptyState: /* @__PURE__ */ v(Fe, { variant: "no-pending", title: l.emptyTitle, message: l.emptyBody }),
      children: F.length > 0 && /* @__PURE__ */ v("tbody", { children: F.map((k) => {
        const A = Jn(k.expires_at), T = S[k.id];
        return /* @__PURE__ */ W("tr", { style: { opacity: T ? 0.7 : 1 }, children: [
          /* @__PURE__ */ v("td", { style: _, children: k.email }),
          /* @__PURE__ */ v("td", { style: _, children: /* @__PURE__ */ v(ht, { role: k.role }) }),
          /* @__PURE__ */ v("td", { style: { ..._, fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }, children: Pe(k.created_at, a) ?? "—" }),
          /* @__PURE__ */ v("td", { style: _, children: A ? /* @__PURE__ */ v(vt, { status: "offline", label: l.expired }) : /* @__PURE__ */ v("span", { style: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }, children: Pe(k.expires_at, a) ?? l.never }) }),
          g && /* @__PURE__ */ v("td", { style: { ..._, textAlign: "right" }, children: /* @__PURE__ */ W("span", { style: { display: "inline-flex", gap: "var(--space-2)", justifyContent: "flex-end" }, children: [
            /* @__PURE__ */ v(ae, { variant: "ghost", size: "sm", disabled: !!T, onClick: () => I(k.id), children: l.resend }),
            /* @__PURE__ */ v(ae, { variant: "danger", size: "sm", disabled: !!T, onClick: () => H(k.id), children: l.revoke })
          ] }) })
        ] }, k.id);
      }) })
    }
  );
}
var nr = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {};
function rr(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default") ? e.default : e;
}
var At = { exports: {} };
/* @license
Papa Parse
v5.5.2
https://github.com/mholt/PapaParse
License: MIT
*/
(function(e, r) {
  ((t, n) => {
    e.exports = n();
  })(nr, function t() {
    var n = typeof self < "u" ? self : typeof window < "u" ? window : n !== void 0 ? n : {}, i, o = !n.document && !!n.postMessage, s = n.IS_PAPA_WORKER || !1, u = {}, a = 0, l = {};
    function g(d) {
      this._handle = null, this._finished = !1, this._completed = !1, this._halted = !1, this._input = null, this._baseIndex = 0, this._partialLine = "", this._rowCount = 0, this._start = 0, this._nextChunk = null, this.isFirstChunk = !0, this._completeResults = { data: [], errors: [], meta: {} }, (function(c) {
        var m = A(c);
        m.chunkSize = parseInt(m.chunkSize), c.step || c.chunk || (m.chunkSize = null), this._handle = new y(m), (this._handle.streamer = this)._config = m;
      }).call(this, d), this.parseChunk = function(c, m) {
        var w = parseInt(this._config.skipFirstNLines) || 0;
        if (this.isFirstChunk && 0 < w) {
          let V = this._config.newline;
          V || (R = this._config.quoteChar || '"', V = this._handle.guessLineEndings(c, R)), c = [...c.split(V).slice(w)].join(V);
        }
        this.isFirstChunk && z(this._config.beforeFirstChunk) && (R = this._config.beforeFirstChunk(c)) !== void 0 && (c = R), this.isFirstChunk = !1, this._halted = !1;
        var w = this._partialLine + c, R = (this._partialLine = "", this._handle.parse(w, this._baseIndex, !this._finished));
        if (!this._handle.paused() && !this._handle.aborted()) {
          if (c = R.meta.cursor, w = (this._finished || (this._partialLine = w.substring(c - this._baseIndex), this._baseIndex = c), R && R.data && (this._rowCount += R.data.length), this._finished || this._config.preview && this._rowCount >= this._config.preview), s) n.postMessage({ results: R, workerId: l.WORKER_ID, finished: w });
          else if (z(this._config.chunk) && !m) {
            if (this._config.chunk(R, this._handle), this._handle.paused() || this._handle.aborted()) return void (this._halted = !0);
            this._completeResults = R = void 0;
          }
          return this._config.step || this._config.chunk || (this._completeResults.data = this._completeResults.data.concat(R.data), this._completeResults.errors = this._completeResults.errors.concat(R.errors), this._completeResults.meta = R.meta), this._completed || !w || !z(this._config.complete) || R && R.meta.aborted || (this._config.complete(this._completeResults, this._input), this._completed = !0), w || R && R.meta.paused || this._nextChunk(), R;
        }
        this._halted = !0;
      }, this._sendError = function(c) {
        z(this._config.error) ? this._config.error(c) : s && this._config.error && n.postMessage({ workerId: l.WORKER_ID, error: c, finished: !1 });
      };
    }
    function S(d) {
      var c;
      (d = d || {}).chunkSize || (d.chunkSize = l.RemoteChunkSize), g.call(this, d), this._nextChunk = o ? function() {
        this._readChunk(), this._chunkLoaded();
      } : function() {
        this._readChunk();
      }, this.stream = function(m) {
        this._input = m, this._nextChunk();
      }, this._readChunk = function() {
        if (this._finished) this._chunkLoaded();
        else {
          if (c = new XMLHttpRequest(), this._config.withCredentials && (c.withCredentials = this._config.withCredentials), o || (c.onload = T(this._chunkLoaded, this), c.onerror = T(this._chunkError, this)), c.open(this._config.downloadRequestBody ? "POST" : "GET", this._input, !o), this._config.downloadRequestHeaders) {
            var m, w = this._config.downloadRequestHeaders;
            for (m in w) c.setRequestHeader(m, w[m]);
          }
          var R;
          this._config.chunkSize && (R = this._start + this._config.chunkSize - 1, c.setRequestHeader("Range", "bytes=" + this._start + "-" + R));
          try {
            c.send(this._config.downloadRequestBody);
          } catch (V) {
            this._chunkError(V.message);
          }
          o && c.status === 0 && this._chunkError();
        }
      }, this._chunkLoaded = function() {
        c.readyState === 4 && (c.status < 200 || 400 <= c.status ? this._chunkError() : (this._start += this._config.chunkSize || c.responseText.length, this._finished = !this._config.chunkSize || this._start >= ((m) => (m = m.getResponseHeader("Content-Range")) !== null ? parseInt(m.substring(m.lastIndexOf("/") + 1)) : -1)(c), this.parseChunk(c.responseText)));
      }, this._chunkError = function(m) {
        m = c.statusText || m, this._sendError(new Error(m));
      };
    }
    function p(d) {
      (d = d || {}).chunkSize || (d.chunkSize = l.LocalChunkSize), g.call(this, d);
      var c, m, w = typeof FileReader < "u";
      this.stream = function(R) {
        this._input = R, m = R.slice || R.webkitSlice || R.mozSlice, w ? ((c = new FileReader()).onload = T(this._chunkLoaded, this), c.onerror = T(this._chunkError, this)) : c = new FileReaderSync(), this._nextChunk();
      }, this._nextChunk = function() {
        this._finished || this._config.preview && !(this._rowCount < this._config.preview) || this._readChunk();
      }, this._readChunk = function() {
        var R = this._input, V = (this._config.chunkSize && (V = Math.min(this._start + this._config.chunkSize, this._input.size), R = m.call(R, this._start, V)), c.readAsText(R, this._config.encoding));
        w || this._chunkLoaded({ target: { result: V } });
      }, this._chunkLoaded = function(R) {
        this._start += this._config.chunkSize, this._finished = !this._config.chunkSize || this._start >= this._input.size, this.parseChunk(R.target.result);
      }, this._chunkError = function() {
        this._sendError(c.error);
      };
    }
    function f(d) {
      var c;
      g.call(this, d = d || {}), this.stream = function(m) {
        return c = m, this._nextChunk();
      }, this._nextChunk = function() {
        var m, w;
        if (!this._finished) return m = this._config.chunkSize, c = m ? (w = c.substring(0, m), c.substring(m)) : (w = c, ""), this._finished = !c, this.parseChunk(w);
      };
    }
    function h(d) {
      g.call(this, d = d || {});
      var c = [], m = !0, w = !1;
      this.pause = function() {
        g.prototype.pause.apply(this, arguments), this._input.pause();
      }, this.resume = function() {
        g.prototype.resume.apply(this, arguments), this._input.resume();
      }, this.stream = function(R) {
        this._input = R, this._input.on("data", this._streamData), this._input.on("end", this._streamEnd), this._input.on("error", this._streamError);
      }, this._checkIsFinished = function() {
        w && c.length === 1 && (this._finished = !0);
      }, this._nextChunk = function() {
        this._checkIsFinished(), c.length ? this.parseChunk(c.shift()) : m = !0;
      }, this._streamData = T(function(R) {
        try {
          c.push(typeof R == "string" ? R : R.toString(this._config.encoding)), m && (m = !1, this._checkIsFinished(), this.parseChunk(c.shift()));
        } catch (V) {
          this._streamError(V);
        }
      }, this), this._streamError = T(function(R) {
        this._streamCleanUp(), this._sendError(R);
      }, this), this._streamEnd = T(function() {
        this._streamCleanUp(), w = !0, this._streamData("");
      }, this), this._streamCleanUp = T(function() {
        this._input.removeListener("data", this._streamData), this._input.removeListener("end", this._streamEnd), this._input.removeListener("error", this._streamError);
      }, this);
    }
    function y(d) {
      var c, m, w, R, V = Math.pow(2, 53), D = -V, Z = /^\s*-?(\d+\.?|\.\d+|\d+\.\d+)([eE][-+]?\d+)?\s*$/, oe = /^((\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z)))$/, L = this, N = 0, C = 0, q = !1, P = !1, x = [], E = { data: [], errors: [], meta: {} };
      function te(G) {
        return d.skipEmptyLines === "greedy" ? G.join("").trim() === "" : G.length === 1 && G[0].length === 0;
      }
      function ee() {
        if (E && w && (ce("Delimiter", "UndetectableDelimiter", "Unable to auto-detect delimiting character; defaulted to '" + l.DefaultDelimiter + "'"), w = !1), d.skipEmptyLines && (E.data = E.data.filter(function(b) {
          return !te(b);
        })), ie()) {
          let b = function(Y, ne) {
            z(d.transformHeader) && (Y = d.transformHeader(Y, ne)), x.push(Y);
          };
          if (E) if (Array.isArray(E.data[0])) {
            for (var G = 0; ie() && G < E.data.length; G++) E.data[G].forEach(b);
            E.data.splice(0, 1);
          } else E.data.forEach(b);
        }
        function j(b, Y) {
          for (var ne = d.header ? {} : [], K = 0; K < b.length; K++) {
            var X = K, B = b[K], B = ((ge, O) => ((J) => (d.dynamicTypingFunction && d.dynamicTyping[J] === void 0 && (d.dynamicTyping[J] = d.dynamicTypingFunction(J)), (d.dynamicTyping[J] || d.dynamicTyping) === !0))(ge) ? O === "true" || O === "TRUE" || O !== "false" && O !== "FALSE" && (((J) => {
              if (Z.test(J) && (J = parseFloat(J), D < J && J < V))
                return 1;
            })(O) ? parseFloat(O) : oe.test(O) ? new Date(O) : O === "" ? null : O) : O)(X = d.header ? K >= x.length ? "__parsed_extra" : x[K] : X, B = d.transform ? d.transform(B, X) : B);
            X === "__parsed_extra" ? (ne[X] = ne[X] || [], ne[X].push(B)) : ne[X] = B;
          }
          return d.header && (K > x.length ? ce("FieldMismatch", "TooManyFields", "Too many fields: expected " + x.length + " fields but parsed " + K, C + Y) : K < x.length && ce("FieldMismatch", "TooFewFields", "Too few fields: expected " + x.length + " fields but parsed " + K, C + Y)), ne;
        }
        var Q;
        E && (d.header || d.dynamicTyping || d.transform) && (Q = 1, !E.data.length || Array.isArray(E.data[0]) ? (E.data = E.data.map(j), Q = E.data.length) : E.data = j(E.data, 0), d.header && E.meta && (E.meta.fields = x), C += Q);
      }
      function ie() {
        return d.header && x.length === 0;
      }
      function ce(G, j, Q, b) {
        G = { type: G, code: j, message: Q }, b !== void 0 && (G.row = b), E.errors.push(G);
      }
      z(d.step) && (R = d.step, d.step = function(G) {
        E = G, ie() ? ee() : (ee(), E.data.length !== 0 && (N += G.data.length, d.preview && N > d.preview ? m.abort() : (E.data = E.data[0], R(E, L))));
      }), this.parse = function(G, j, Q) {
        var b = d.quoteChar || '"', b = (d.newline || (d.newline = this.guessLineEndings(G, b)), w = !1, d.delimiter ? z(d.delimiter) && (d.delimiter = d.delimiter(G), E.meta.delimiter = d.delimiter) : ((b = ((Y, ne, K, X, B) => {
          var ge, O, J, ye;
          B = B || [",", "	", "|", ";", l.RECORD_SEP, l.UNIT_SEP];
          for (var Re = 0; Re < B.length; Re++) {
            for (var pe, Ee = B[Re], se = 0, me = 0, re = 0, ue = (J = void 0, new I({ comments: X, delimiter: Ee, newline: ne, preview: 10 }).parse(Y)), ve = 0; ve < ue.data.length; ve++) K && te(ue.data[ve]) ? re++ : (pe = ue.data[ve].length, me += pe, J === void 0 ? J = pe : 0 < pe && (se += Math.abs(pe - J), J = pe));
            0 < ue.data.length && (me /= ue.data.length - re), (O === void 0 || se <= O) && (ye === void 0 || ye < me) && 1.99 < me && (O = se, ge = Ee, ye = me);
          }
          return { successful: !!(d.delimiter = ge), bestDelimiter: ge };
        })(G, d.newline, d.skipEmptyLines, d.comments, d.delimitersToGuess)).successful ? d.delimiter = b.bestDelimiter : (w = !0, d.delimiter = l.DefaultDelimiter), E.meta.delimiter = d.delimiter), A(d));
        return d.preview && d.header && b.preview++, c = G, m = new I(b), E = m.parse(c, j, Q), ee(), q ? { meta: { paused: !0 } } : E || { meta: { paused: !1 } };
      }, this.paused = function() {
        return q;
      }, this.pause = function() {
        q = !0, m.abort(), c = z(d.chunk) ? "" : c.substring(m.getCharIndex());
      }, this.resume = function() {
        L.streamer._halted ? (q = !1, L.streamer.parseChunk(c, !0)) : setTimeout(L.resume, 3);
      }, this.aborted = function() {
        return P;
      }, this.abort = function() {
        P = !0, m.abort(), E.meta.aborted = !0, z(d.complete) && d.complete(E), c = "";
      }, this.guessLineEndings = function(Y, b) {
        Y = Y.substring(0, 1048576);
        var b = new RegExp(F(b) + "([^]*?)" + F(b), "gm"), Q = (Y = Y.replace(b, "")).split("\r"), b = Y.split(`
`), Y = 1 < b.length && b[0].length < Q[0].length;
        if (Q.length === 1 || Y) return `
`;
        for (var ne = 0, K = 0; K < Q.length; K++) Q[K][0] === `
` && ne++;
        return ne >= Q.length / 2 ? `\r
` : "\r";
      };
    }
    function F(d) {
      return d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function I(d) {
      var c = (d = d || {}).delimiter, m = d.newline, w = d.comments, R = d.step, V = d.preview, D = d.fastMode, Z = null, oe = !1, L = d.quoteChar == null ? '"' : d.quoteChar, N = L;
      if (d.escapeChar !== void 0 && (N = d.escapeChar), (typeof c != "string" || -1 < l.BAD_DELIMITERS.indexOf(c)) && (c = ","), w === c) throw new Error("Comment character same as delimiter");
      w === !0 ? w = "#" : (typeof w != "string" || -1 < l.BAD_DELIMITERS.indexOf(w)) && (w = !1), m !== `
` && m !== "\r" && m !== `\r
` && (m = `
`);
      var C = 0, q = !1;
      this.parse = function(P, x, E) {
        if (typeof P != "string") throw new Error("Input must be a string");
        var te = P.length, ee = c.length, ie = m.length, ce = w.length, G = z(R), j = [], Q = [], b = [], Y = C = 0;
        if (!P) return se();
        if (D || D !== !1 && P.indexOf(L) === -1) {
          for (var ne = P.split(m), K = 0; K < ne.length; K++) {
            if (b = ne[K], C += b.length, K !== ne.length - 1) C += m.length;
            else if (E) return se();
            if (!w || b.substring(0, ce) !== w) {
              if (G) {
                if (j = [], ye(b.split(c)), me(), q) return se();
              } else ye(b.split(c));
              if (V && V <= K) return j = j.slice(0, V), se(!0);
            }
          }
          return se();
        }
        for (var X = P.indexOf(c, C), B = P.indexOf(m, C), ge = new RegExp(F(N) + F(L), "g"), O = P.indexOf(L, C); ; ) if (P[C] === L) for (O = C, C++; ; ) {
          if ((O = P.indexOf(L, O + 1)) === -1) return E || Q.push({ type: "Quotes", code: "MissingQuotes", message: "Quoted field unterminated", row: j.length, index: C }), pe();
          if (O === te - 1) return pe(P.substring(C, O).replace(ge, L));
          if (L === N && P[O + 1] === N) O++;
          else if (L === N || O === 0 || P[O - 1] !== N) {
            X !== -1 && X < O + 1 && (X = P.indexOf(c, O + 1));
            var J = Re((B = B !== -1 && B < O + 1 ? P.indexOf(m, O + 1) : B) === -1 ? X : Math.min(X, B));
            if (P.substr(O + 1 + J, ee) === c) {
              b.push(P.substring(C, O).replace(ge, L)), P[C = O + 1 + J + ee] !== L && (O = P.indexOf(L, C)), X = P.indexOf(c, C), B = P.indexOf(m, C);
              break;
            }
            if (J = Re(B), P.substring(O + 1 + J, O + 1 + J + ie) === m) {
              if (b.push(P.substring(C, O).replace(ge, L)), Ee(O + 1 + J + ie), X = P.indexOf(c, C), O = P.indexOf(L, C), G && (me(), q)) return se();
              if (V && j.length >= V) return se(!0);
              break;
            }
            Q.push({ type: "Quotes", code: "InvalidQuotes", message: "Trailing quote on quoted field is malformed", row: j.length, index: C }), O++;
          }
        }
        else if (w && b.length === 0 && P.substring(C, C + ce) === w) {
          if (B === -1) return se();
          C = B + ie, B = P.indexOf(m, C), X = P.indexOf(c, C);
        } else if (X !== -1 && (X < B || B === -1)) b.push(P.substring(C, X)), C = X + ee, X = P.indexOf(c, C);
        else {
          if (B === -1) break;
          if (b.push(P.substring(C, B)), Ee(B + ie), G && (me(), q)) return se();
          if (V && j.length >= V) return se(!0);
        }
        return pe();
        function ye(re) {
          j.push(re), Y = C;
        }
        function Re(re) {
          var ue = 0;
          return ue = re !== -1 && (re = P.substring(O + 1, re)) && re.trim() === "" ? re.length : ue;
        }
        function pe(re) {
          return E || (re === void 0 && (re = P.substring(C)), b.push(re), C = te, ye(b), G && me()), se();
        }
        function Ee(re) {
          C = re, ye(b), b = [], B = P.indexOf(m, C);
        }
        function se(re) {
          if (d.header && !x && j.length && !oe) {
            var ue = j[0], ve = {}, Ge = new Set(ue);
            let dt = !1;
            for (let xe = 0; xe < ue.length; xe++) {
              let he = ue[xe];
              if (ve[he = z(d.transformHeader) ? d.transformHeader(he, xe) : he]) {
                let Ie, ct = ve[he];
                for (; Ie = he + "_" + ct, ct++, Ge.has(Ie); ) ;
                Ge.add(Ie), ue[xe] = Ie, ve[he]++, dt = !0, (Z = Z === null ? {} : Z)[Ie] = he;
              } else ve[he] = 1, ue[xe] = he;
              Ge.add(he);
            }
            dt && console.warn("Duplicate headers found and renamed."), oe = !0;
          }
          return { data: j, errors: Q, meta: { delimiter: c, linebreak: m, aborted: q, truncated: !!re, cursor: Y + (x || 0), renamedHeaders: Z } };
        }
        function me() {
          R(se()), j = [], Q = [];
        }
      }, this.abort = function() {
        q = !0;
      }, this.getCharIndex = function() {
        return C;
      };
    }
    function H(d) {
      var c = d.data, m = u[c.workerId], w = !1;
      if (c.error) m.userError(c.error, c.file);
      else if (c.results && c.results.data) {
        var R = { abort: function() {
          w = !0, _(c.workerId, { data: [], errors: [], meta: { aborted: !0 } });
        }, pause: k, resume: k };
        if (z(m.userStep)) {
          for (var V = 0; V < c.results.data.length && (m.userStep({ data: c.results.data[V], errors: c.results.errors, meta: c.results.meta }, R), !w); V++) ;
          delete c.results;
        } else z(m.userChunk) && (m.userChunk(c.results, R, c.file), delete c.results);
      }
      c.finished && !w && _(c.workerId, c.results);
    }
    function _(d, c) {
      var m = u[d];
      z(m.userComplete) && m.userComplete(c), m.terminate(), delete u[d];
    }
    function k() {
      throw new Error("Not implemented.");
    }
    function A(d) {
      if (typeof d != "object" || d === null) return d;
      var c, m = Array.isArray(d) ? [] : {};
      for (c in d) m[c] = A(d[c]);
      return m;
    }
    function T(d, c) {
      return function() {
        d.apply(c, arguments);
      };
    }
    function z(d) {
      return typeof d == "function";
    }
    return l.parse = function(d, c) {
      var m = (c = c || {}).dynamicTyping || !1;
      if (z(m) && (c.dynamicTypingFunction = m, m = {}), c.dynamicTyping = m, c.transform = !!z(c.transform) && c.transform, !c.worker || !l.WORKERS_SUPPORTED) return m = null, l.NODE_STREAM_INPUT, typeof d == "string" ? (d = ((w) => w.charCodeAt(0) !== 65279 ? w : w.slice(1))(d), m = new (c.download ? S : f)(c)) : d.readable === !0 && z(d.read) && z(d.on) ? m = new h(c) : (n.File && d instanceof File || d instanceof Object) && (m = new p(c)), m.stream(d);
      (m = (() => {
        var w;
        return !!l.WORKERS_SUPPORTED && (w = (() => {
          var R = n.URL || n.webkitURL || null, V = t.toString();
          return l.BLOB_URL || (l.BLOB_URL = R.createObjectURL(new Blob(["var global = (function() { if (typeof self !== 'undefined') { return self; } if (typeof window !== 'undefined') { return window; } if (typeof global !== 'undefined') { return global; } return {}; })(); global.IS_PAPA_WORKER=true; ", "(", V, ")();"], { type: "text/javascript" })));
        })(), (w = new n.Worker(w)).onmessage = H, w.id = a++, u[w.id] = w);
      })()).userStep = c.step, m.userChunk = c.chunk, m.userComplete = c.complete, m.userError = c.error, c.step = z(c.step), c.chunk = z(c.chunk), c.complete = z(c.complete), c.error = z(c.error), delete c.worker, m.postMessage({ input: d, config: c, workerId: m.id });
    }, l.unparse = function(d, c) {
      var m = !1, w = !0, R = ",", V = `\r
`, D = '"', Z = D + D, oe = !1, L = null, N = !1, C = ((() => {
        if (typeof c == "object") {
          if (typeof c.delimiter != "string" || l.BAD_DELIMITERS.filter(function(x) {
            return c.delimiter.indexOf(x) !== -1;
          }).length || (R = c.delimiter), typeof c.quotes != "boolean" && typeof c.quotes != "function" && !Array.isArray(c.quotes) || (m = c.quotes), typeof c.skipEmptyLines != "boolean" && typeof c.skipEmptyLines != "string" || (oe = c.skipEmptyLines), typeof c.newline == "string" && (V = c.newline), typeof c.quoteChar == "string" && (D = c.quoteChar), typeof c.header == "boolean" && (w = c.header), Array.isArray(c.columns)) {
            if (c.columns.length === 0) throw new Error("Option columns is empty");
            L = c.columns;
          }
          c.escapeChar !== void 0 && (Z = c.escapeChar + D), c.escapeFormulae instanceof RegExp ? N = c.escapeFormulae : typeof c.escapeFormulae == "boolean" && c.escapeFormulae && (N = /^[=+\-@\t\r].*$/);
        }
      })(), new RegExp(F(D), "g"));
      if (typeof d == "string" && (d = JSON.parse(d)), Array.isArray(d)) {
        if (!d.length || Array.isArray(d[0])) return q(null, d, oe);
        if (typeof d[0] == "object") return q(L || Object.keys(d[0]), d, oe);
      } else if (typeof d == "object") return typeof d.data == "string" && (d.data = JSON.parse(d.data)), Array.isArray(d.data) && (d.fields || (d.fields = d.meta && d.meta.fields || L), d.fields || (d.fields = Array.isArray(d.data[0]) ? d.fields : typeof d.data[0] == "object" ? Object.keys(d.data[0]) : []), Array.isArray(d.data[0]) || typeof d.data[0] == "object" || (d.data = [d.data])), q(d.fields || [], d.data || [], oe);
      throw new Error("Unable to serialize unrecognized input");
      function q(x, E, te) {
        var ee = "", ie = (typeof x == "string" && (x = JSON.parse(x)), typeof E == "string" && (E = JSON.parse(E)), Array.isArray(x) && 0 < x.length), ce = !Array.isArray(E[0]);
        if (ie && w) {
          for (var G = 0; G < x.length; G++) 0 < G && (ee += R), ee += P(x[G], G);
          0 < E.length && (ee += V);
        }
        for (var j = 0; j < E.length; j++) {
          var Q = (ie ? x : E[j]).length, b = !1, Y = ie ? Object.keys(E[j]).length === 0 : E[j].length === 0;
          if (te && !ie && (b = te === "greedy" ? E[j].join("").trim() === "" : E[j].length === 1 && E[j][0].length === 0), te === "greedy" && ie) {
            for (var ne = [], K = 0; K < Q; K++) {
              var X = ce ? x[K] : K;
              ne.push(E[j][X]);
            }
            b = ne.join("").trim() === "";
          }
          if (!b) {
            for (var B = 0; B < Q; B++) {
              0 < B && !Y && (ee += R);
              var ge = ie && ce ? x[B] : B;
              ee += P(E[j][ge], B);
            }
            j < E.length - 1 && (!te || 0 < Q && !Y) && (ee += V);
          }
        }
        return ee;
      }
      function P(x, E) {
        var te, ee;
        return x == null ? "" : x.constructor === Date ? JSON.stringify(x).slice(1, 25) : (ee = !1, N && typeof x == "string" && N.test(x) && (x = "'" + x, ee = !0), te = x.toString().replace(C, Z), (ee = ee || m === !0 || typeof m == "function" && m(x, E) || Array.isArray(m) && m[E] || ((ie, ce) => {
          for (var G = 0; G < ce.length; G++) if (-1 < ie.indexOf(ce[G])) return !0;
          return !1;
        })(te, l.BAD_DELIMITERS) || -1 < te.indexOf(R) || te.charAt(0) === " " || te.charAt(te.length - 1) === " ") ? D + te + D : te);
      }
    }, l.RECORD_SEP = "", l.UNIT_SEP = "", l.BYTE_ORDER_MARK = "\uFEFF", l.BAD_DELIMITERS = ["\r", `
`, '"', l.BYTE_ORDER_MARK], l.WORKERS_SUPPORTED = !o && !!n.Worker, l.NODE_STREAM_INPUT = 1, l.LocalChunkSize = 10485760, l.RemoteChunkSize = 5242880, l.DefaultDelimiter = ",", l.Parser = I, l.ParserHandle = y, l.NetworkStreamer = S, l.FileStreamer = p, l.StringStreamer = f, l.ReadableStreamStreamer = h, n.jQuery && ((i = n.jQuery).fn.parse = function(d) {
      var c = d.config || {}, m = [];
      return this.each(function(V) {
        if (!(i(this).prop("tagName").toUpperCase() === "INPUT" && i(this).attr("type").toLowerCase() === "file" && n.FileReader) || !this.files || this.files.length === 0) return !0;
        for (var D = 0; D < this.files.length; D++) m.push({ file: this.files[D], inputElem: this, instanceConfig: i.extend({}, c) });
      }), w(), this;
      function w() {
        if (m.length === 0) z(d.complete) && d.complete();
        else {
          var V, D, Z, oe, L = m[0];
          if (z(d.before)) {
            var N = d.before(L.file, L.inputElem);
            if (typeof N == "object") {
              if (N.action === "abort") return V = "AbortError", D = L.file, Z = L.inputElem, oe = N.reason, void (z(d.error) && d.error({ name: V }, D, Z, oe));
              if (N.action === "skip") return void R();
              typeof N.config == "object" && (L.instanceConfig = i.extend(L.instanceConfig, N.config));
            } else if (N === "skip") return void R();
          }
          var C = L.instanceConfig.complete;
          L.instanceConfig.complete = function(q) {
            z(C) && C(q, L.file, L.inputElem), R();
          }, l.parse(L.file, L.instanceConfig);
        }
      }
      function R() {
        m.splice(0, 1), w();
      }
    }), s && (n.onmessage = function(d) {
      d = d.data, l.WORKER_ID === void 0 && d && (l.WORKER_ID = d.workerId), typeof d.input == "string" ? n.postMessage({ workerId: l.WORKER_ID, results: l.parse(d.input, d.config), finished: !0 }) : (n.File && d.input instanceof File || d.input instanceof Object) && (d = l.parse(d.input, d.config)) && n.postMessage({ workerId: l.WORKER_ID, results: d, finished: !0 });
    }), (S.prototype = Object.create(g.prototype)).constructor = S, (p.prototype = Object.create(g.prototype)).constructor = p, (f.prototype = Object.create(f.prototype)).constructor = f, (h.prototype = Object.create(g.prototype)).constructor = h, l;
  });
})(At);
var ir = At.exports;
const or = /* @__PURE__ */ rr(ir), sr = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function bt(e) {
  return sr.test(e.trim());
}
function lr(e) {
  const r = e.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
  return Dt(r);
}
function ar(e) {
  const t = or.parse(e.replace(/^﻿/, ""), {
    skipEmptyLines: !0
  }).data ?? [];
  if (t.length === 0) return [];
  const n = t[0].map((a) => String(a).trim().toLowerCase()), i = n.indexOf("email");
  let o = t, s = 0;
  i !== -1 ? (s = i, o = t.slice(1)) : n.some((a) => a === "role" || a === "name") && (o = t.slice(1));
  const u = o.map((a) => String(a[s] ?? "").trim()).filter(Boolean);
  return Dt(u);
}
function Dt(e) {
  const r = /* @__PURE__ */ new Set(), t = [];
  for (const n of e) {
    const i = n.toLowerCase();
    r.has(i) || (r.add(i), t.push({ email: n, valid: bt(n) }));
  }
  return t;
}
const ur = ["admin", "member", "viewer"];
function dr({ open: e, onClose: r, onInvite: t, onBulkInvite: n, onSuccess: i, defaultRole: o = "member" }) {
  const { messages: s, t: u } = Ce(), a = s.invitations, [l, g] = U("single"), [S, p] = U(o), [f, h] = U(""), [y, F] = U(null), [I, H] = U(""), [_, k] = U(null), [A, T] = U(!1), [z, d] = U(null), [c, m] = U(null), w = Oe(() => _ || lr(I), [_, I]), R = w.filter((C) => C.valid), V = ur.map((C) => ({ value: C, label: s.roles[C] }));
  function D() {
    A || (g("single"), h(""), F(null), H(""), k(null), d(null), m(null), r());
  }
  async function Z() {
    if (!bt(f)) {
      F(a.invalidEmail);
      return;
    }
    d(null), T(!0);
    try {
      await t(f.trim(), S), m(u(a.invitedCount, { count: 1 })), i == null || i(1), D();
    } catch (C) {
      d(C instanceof Error ? C.message : "Failed");
    } finally {
      T(!1);
    }
  }
  async function oe() {
    if (R.length === 0) {
      d(a.noValidEmails);
      return;
    }
    d(null), T(!0);
    try {
      const C = await n(R.map((q) => ({ email: q.email.trim(), role: S })));
      m(
        `${u(a.invitedCount, { count: C.created })}` + (C.skipped ? ` · ${C.skipped} ${a.skipped}` : "") + (C.errors.length ? ` · ${C.errors.length} ${a.errors}` : "")
      ), i == null || i(C.created), C.errors.length === 0 && D();
    } catch (C) {
      d(C instanceof Error ? C.message : "Failed");
    } finally {
      T(!1);
    }
  }
  async function L(C) {
    const q = Array.from(C)[0];
    if (!q) return;
    const P = await q.text();
    k(ar(P));
  }
  if (!e) return null;
  const N = (C, q) => /* @__PURE__ */ v(
    "button",
    {
      type: "button",
      role: "tab",
      "aria-selected": l === C,
      onClick: () => g(C),
      style: {
        appearance: "none",
        background: "none",
        border: "none",
        borderBottom: l === C ? "2px solid var(--accent-color)" : "2px solid transparent",
        padding: "var(--space-2) var(--space-3)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-medium)",
        color: l === C ? "var(--text-primary)" : "var(--text-secondary)",
        cursor: "pointer"
      },
      children: q
    }
  );
  return /* @__PURE__ */ v(st, { open: e, onClose: D, title: a.inviteTitle, size: "md", children: /* @__PURE__ */ W("div", { style: { display: "flex", flexDirection: "column", gap: "var(--space-4)" }, children: [
    /* @__PURE__ */ W("div", { role: "tablist", style: { display: "flex", gap: "var(--space-2)", borderBottom: "1px solid var(--border-color)" }, children: [
      N("single", a.tabSingle),
      N("bulk", a.tabBulk)
    ] }),
    z && /* @__PURE__ */ v(Te, { level: "error", message: z }),
    c && /* @__PURE__ */ v("div", { role: "status", "aria-live": "polite", style: { fontSize: "var(--text-sm)", color: "var(--text-secondary)" }, children: c }),
    l === "single" ? /* @__PURE__ */ W(Qe, { children: [
      /* @__PURE__ */ v(
        St,
        {
          label: a.email,
          type: "email",
          placeholder: a.emailPlaceholder,
          value: f,
          error: y ?? void 0,
          onChange: (C) => {
            h(C.target.value), y && F(null);
          }
        }
      ),
      /* @__PURE__ */ v(Le, { label: a.role, value: S, options: V, onChange: (C) => p(C.target.value) }),
      /* @__PURE__ */ W("div", { style: { display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }, children: [
        /* @__PURE__ */ v(ae, { variant: "ghost", onClick: D, children: s.common.cancel }),
        /* @__PURE__ */ v(ae, { variant: "primary", onClick: Z, disabled: A, children: a.send })
      ] })
    ] }) : /* @__PURE__ */ W(Qe, { children: [
      /* @__PURE__ */ v(
        Bt,
        {
          label: a.bulkTextareaLabel,
          placeholder: a.bulkTextareaPlaceholder,
          value: I,
          rows: 4,
          onChange: (C) => {
            H(C.target.value), k(null);
          }
        }
      ),
      /* @__PURE__ */ v(Ut, { accept: ".csv", label: a.csvHint, onFiles: L }),
      /* @__PURE__ */ v(Le, { label: a.role, value: S, options: V, onChange: (C) => p(C.target.value) }),
      w.length > 0 && /* @__PURE__ */ W("div", { children: [
        /* @__PURE__ */ W("div", { style: { fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: "var(--space-1)" }, children: [
          a.previewTitle,
          " (",
          R.length,
          ")"
        ] }),
        /* @__PURE__ */ v(
          "div",
          {
            style: {
              maxHeight: 140,
              overflowY: "auto",
              background: "var(--bg-quaternary)",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-2)",
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-1)"
            },
            children: w.map((C) => /* @__PURE__ */ v(De, { tone: C.valid ? "neutral" : "error", mono: !0, size: "sm", children: C.email }, C.email))
          }
        )
      ] }),
      /* @__PURE__ */ W("div", { style: { display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }, children: [
        /* @__PURE__ */ v(ae, { variant: "ghost", onClick: D, children: s.common.cancel }),
        /* @__PURE__ */ v(ae, { variant: "primary", onClick: oe, disabled: A || R.length === 0, children: a.sendBulk })
      ] })
    ] })
  ] }) });
}
function cr({
  open: e,
  title: r,
  message: t,
  subject: n,
  onCancel: i,
  onConfirm: o,
  confirmLabel: s
}) {
  const { messages: u } = Ce(), [a, l] = U(!1), [g, S] = U(null), p = "revoke-desc";
  async function f() {
    S(null), l(!0);
    try {
      await o();
    } catch (y) {
      S(y instanceof Error ? y.message : "Action failed"), l(!1);
    }
  }
  function h() {
    a || (S(null), i());
  }
  return e ? /* @__PURE__ */ v(st, { open: e, onClose: h, title: r, size: "md", children: /* @__PURE__ */ W("div", { style: { display: "flex", flexDirection: "column", gap: "var(--space-4)" }, children: [
    g && /* @__PURE__ */ v(Te, { level: "error", message: g }),
    /* @__PURE__ */ v(
      "p",
      {
        id: p,
        style: { margin: 0, fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },
        children: t
      }
    ),
    n && /* @__PURE__ */ v(
      "code",
      {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-xs)",
          color: "var(--text-primary)",
          background: "var(--bg-quaternary)",
          padding: "var(--space-2) var(--space-3)",
          borderRadius: "var(--radius-sm)"
        },
        children: n
      }
    ),
    /* @__PURE__ */ W("div", { style: { display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }, children: [
      /* @__PURE__ */ v(ae, { variant: "ghost", onClick: h, disabled: a, children: u.common.cancel }),
      /* @__PURE__ */ v(
        ae,
        {
          variant: "danger",
          onClick: f,
          disabled: a,
          "aria-describedby": p,
          children: s ?? u.common.confirm
        }
      )
    ] })
  ] }) }) : null;
}
function gr({ tokens: e, loading: r, error: t, onRevoke: n, onRetry: i }) {
  const { messages: o, locale: s } = Ce(), u = o.tokens, [a, l] = U(null), g = [
    { key: "name", header: u.name },
    { key: "type", header: u.type },
    { key: "scopes", header: u.scopes },
    { key: "expires", header: u.expires },
    { key: "lastUsed", header: u.lastUsed },
    { key: "actions", header: o.common.actions, align: "right" }
  ];
  if (t)
    return /* @__PURE__ */ v(Fe, { variant: "error", message: t, actionLabel: o.common.retry, onAction: i });
  const S = {
    padding: "var(--space-3) var(--space-4)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    color: "var(--text-primary)",
    borderBottom: "1px solid var(--border-color)",
    verticalAlign: "middle"
  };
  return /* @__PURE__ */ W(Qe, { children: [
    /* @__PURE__ */ v(
      ot,
      {
        columns: g,
        loading: r,
        emptyState: /* @__PURE__ */ v(Fe, { variant: "no-tokens", title: u.emptyTitle, message: u.emptyBody }),
        children: e.length > 0 && /* @__PURE__ */ v("tbody", { children: e.map((p) => {
          const f = Xn(p.expires_at);
          return /* @__PURE__ */ W("tr", { children: [
            /* @__PURE__ */ v("td", { style: S, children: p.name }),
            /* @__PURE__ */ v("td", { style: S, children: /* @__PURE__ */ v(De, { tone: p.owner_type === "org" ? "accent" : "neutral", children: p.owner_type === "org" ? u.typeService : u.typePat }) }),
            /* @__PURE__ */ v("td", { style: S, children: /* @__PURE__ */ v("span", { style: { display: "inline-flex", flexWrap: "wrap", gap: "var(--space-1)" }, children: p.scopes.map((h) => /* @__PURE__ */ v(De, { tone: "neutral", mono: !0, size: "sm", children: o.scopeLabels[h] ?? h }, h)) }) }),
            /* @__PURE__ */ v("td", { style: S, children: /* @__PURE__ */ W("span", { style: { display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }, children: [
              Pe(p.expires_at, s) ?? u.never,
              f && /* @__PURE__ */ v(De, { tone: "warning", size: "sm", dot: !0, children: u.expiresSoon })
            ] }) }),
            /* @__PURE__ */ v("td", { style: S, children: Pe(p.last_used_at, s) ?? u.never }),
            /* @__PURE__ */ v("td", { style: { ...S, textAlign: "right" }, children: /* @__PURE__ */ v(ae, { variant: "ghost", size: "sm", onClick: () => l(p), children: u.revoke }) })
          ] }, p.id);
        }) })
      }
    ),
    /* @__PURE__ */ v(
      cr,
      {
        open: !!a,
        title: u.revokeTitle,
        message: u.revokeConfirm,
        subject: a ? `${a.name} · ${a.token_prefix}…` : void 0,
        confirmLabel: u.revoke,
        onCancel: () => l(null),
        onConfirm: async () => {
          a && (await n(a.id), l(null));
        }
      }
    )
  ] });
}
const it = [
  {
    key: "apps",
    scopes: ["App:read", "App:create", "App:update", "App:delete", "App:install", "App:uninstall"]
  },
  {
    key: "organization",
    scopes: ["Organization:read", "Organization:update", "Organization:manage"]
  },
  {
    key: "userManagement",
    scopes: [
      "UserManagement:view_members",
      "UserManagement:invite",
      "UserManagement:remove",
      "UserManagement:update_role"
    ]
  }
], wr = it.flatMap((e) => e.scopes);
function fr({ value: e, onChange: r, availableScopes: t, disabled: n }) {
  const { messages: i } = Ce(), o = new Set(e), s = t ? new Set(t) : null;
  function u(a) {
    const l = new Set(o);
    l.has(a) ? l.delete(a) : l.add(a), r(it.flatMap((g) => g.scopes).filter((g) => l.has(g)));
  }
  return /* @__PURE__ */ v("div", { style: { display: "flex", flexDirection: "column", gap: "var(--space-4)" }, children: it.map((a) => /* @__PURE__ */ W(
    "fieldset",
    {
      style: { border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" },
      children: [
        /* @__PURE__ */ v(
          "legend",
          {
            style: {
              padding: 0,
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-xs)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em"
            },
            children: i.scopeGroups[a.key]
          }
        ),
        /* @__PURE__ */ v("div", { style: { display: "flex", flexDirection: "column", gap: "var(--space-1)" }, children: a.scopes.map((l) => {
          const g = n || (s ? !s.has(l) : !1), S = i.scopeLabels[l] ?? l;
          return /* @__PURE__ */ W(
            "label",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-sm)",
                color: g ? "var(--text-tertiary)" : "var(--text-primary)",
                cursor: g ? "not-allowed" : "pointer",
                opacity: g ? 0.6 : 1
              },
              children: [
                /* @__PURE__ */ v(
                  "input",
                  {
                    type: "checkbox",
                    "aria-label": S,
                    checked: o.has(l),
                    disabled: g,
                    onChange: () => u(l),
                    style: { accentColor: "var(--accent-color)" }
                  }
                ),
                S
              ]
            },
            l
          );
        }) })
      ]
    },
    a.key
  )) });
}
const pr = [
  { value: "never", label: "noExpiry" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "365 days" }
];
function mr(e) {
  if (e === "never") return null;
  const r = Number(e);
  return new Date(Date.now() + r * 24 * 60 * 60 * 1e3).toISOString();
}
function hr({
  open: e,
  onClose: r,
  ownerType: t,
  ownerId: n,
  orgId: i,
  availableScopes: o,
  onCreate: s,
  onCreated: u
}) {
  const { messages: a } = Ce(), l = a.tokens, [g, S] = U("form"), [p, f] = U(""), [h, y] = U([]), [F, I] = U("never"), [H, _] = U(null), [k, A] = U(null), [T, z] = U(null), [d, c] = U(!1);
  function m() {
    S("form"), f(""), y([]), I("never"), _(null), A(null), z(null), c(!1);
  }
  function w() {
    m(), r();
  }
  async function R() {
    if (!p.trim()) {
      _("Name is required");
      return;
    }
    A(null), S("submitting");
    try {
      const D = {
        name: p.trim(),
        owner_type: t,
        owner_id: n,
        scopes: h,
        expires_at: mr(F),
        ...i ? { org_id: i } : {}
      }, Z = await s(D);
      z(Z), S("revealed"), u == null || u(Z);
    } catch (D) {
      A(D instanceof Error ? D.message : l.createError), S("form");
    }
  }
  async function V() {
    if (T)
      try {
        await navigator.clipboard.writeText(T.token), c(!0);
      } catch {
      }
  }
  return e ? /* @__PURE__ */ v(st, { open: e, onClose: w, title: g === "revealed" ? l.revealTitle : l.create, size: "md", children: g === "revealed" && T ? /* @__PURE__ */ W("div", { style: { display: "flex", flexDirection: "column", gap: "var(--space-4)" }, children: [
    /* @__PURE__ */ v(Te, { level: "warning", message: l.revealWarning }),
    /* @__PURE__ */ v(
      "input",
      {
        readOnly: !0,
        value: T.token,
        "aria-label": l.revealTitle,
        onFocus: (D) => D.currentTarget.select(),
        style: {
          width: "100%",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-sm)",
          padding: "var(--space-3)",
          background: "var(--bg-quaternary)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-md)"
        }
      }
    ),
    /* @__PURE__ */ W("div", { style: { display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }, children: [
      /* @__PURE__ */ v(ae, { variant: "secondary", onClick: V, "aria-live": "polite", children: d ? l.copied : l.copy }),
      /* @__PURE__ */ v(ae, { variant: "primary", onClick: w, children: l.done })
    ] })
  ] }) : /* @__PURE__ */ W("div", { style: { display: "flex", flexDirection: "column", gap: "var(--space-4)" }, children: [
    k && /* @__PURE__ */ v(Te, { level: "error", message: k }),
    /* @__PURE__ */ v(
      St,
      {
        label: l.nameLabel,
        placeholder: l.namePlaceholder,
        value: p,
        error: H ?? void 0,
        onChange: (D) => {
          f(D.target.value), H && _(null);
        }
      }
    ),
    /* @__PURE__ */ W("div", { children: [
      /* @__PURE__ */ v(
        "label",
        {
          style: {
            display: "block",
            marginBottom: "var(--space-2)",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.05em"
          },
          children: l.scopesLabel
        }
      ),
      /* @__PURE__ */ v(fr, { value: h, onChange: y, availableScopes: o })
    ] }),
    /* @__PURE__ */ v(
      Le,
      {
        label: l.expiryLabel,
        value: F,
        onChange: (D) => I(D.target.value),
        options: pr.map((D) => ({
          value: D.value,
          label: D.value === "never" ? l.noExpiry : D.label
        }))
      }
    ),
    /* @__PURE__ */ W("div", { style: { display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }, children: [
      /* @__PURE__ */ v(ae, { variant: "ghost", onClick: w, children: a.common.cancel }),
      /* @__PURE__ */ v(ae, { variant: "primary", onClick: R, disabled: g === "submitting", children: l.create })
    ] })
  ] }) }) : null;
}
function _r(e) {
  return /* @__PURE__ */ v(Kt, { locale: e.locale ?? "en", children: /* @__PURE__ */ v(vr, { ...e }) });
}
function vr({
  organizationId: e,
  userRole: r,
  userId: t,
  apiClient: n,
  getToken: i,
  onMembersChange: o
}) {
  const { messages: s, dir: u } = Ce(), a = Oe(() => n ?? Yt({ getToken: i }), [n, i]), l = !!t || r === "owner" || r === "admin", [g, S] = U("members"), [p, f] = U([]), [h, y] = U(!0), [F, I] = U(null), [H, _] = U([]), [k, A] = U(!0), [T, z] = U(null), [d, c] = U([]), [m, w] = U(!0), [R, V] = U(null), [D, Z] = U(!1), [oe, L] = U(!1), N = Be(async () => {
    y(!0), I(null);
    try {
      f(await a.listMembers(e));
    } catch (x) {
      I(x instanceof Error ? x.message : "Error");
    } finally {
      y(!1);
    }
  }, [a, e]), C = Be(async () => {
    A(!0), z(null);
    try {
      _(await a.listInvitations(e));
    } catch (x) {
      z(x instanceof Error ? x.message : "Error");
    } finally {
      A(!1);
    }
  }, [a, e]), q = Be(async () => {
    w(!0), V(null);
    try {
      const x = t ? await a.listTokens() : await a.listOrgTokens(e);
      c(x);
    } catch (x) {
      V(x instanceof Error ? x.message : "Error");
    } finally {
      w(!1);
    }
  }, [a, e, t]);
  Ot(() => {
    N(), C(), q();
  }, [N, C, q]);
  const P = (x, E) => /* @__PURE__ */ v(
    "button",
    {
      type: "button",
      role: "tab",
      "aria-selected": g === x,
      onClick: () => S(x),
      style: {
        appearance: "none",
        background: "none",
        border: "none",
        borderBottom: g === x ? "2px solid var(--accent-color)" : "2px solid transparent",
        padding: "var(--space-3) var(--space-4)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-medium)",
        color: g === x ? "var(--text-primary)" : "var(--text-secondary)",
        cursor: "pointer"
      },
      children: E
    }
  );
  return /* @__PURE__ */ W(
    "div",
    {
      dir: u,
      style: {
        maxWidth: "var(--container-max)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)"
      },
      children: [
        /* @__PURE__ */ W("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)" }, children: [
          /* @__PURE__ */ W("div", { role: "tablist", style: { display: "flex", gap: "var(--space-2)", borderBottom: "1px solid var(--border-color)", flex: 1 }, children: [
            P("members", s.members.title),
            P("pending", s.invitations.title),
            P("tokens", s.tokens.title)
          ] }),
          g === "members" && (r === "owner" || r === "admin") && /* @__PURE__ */ v(ae, { variant: "primary", onClick: () => Z(!0), children: s.members.invite }),
          g === "tokens" && l && /* @__PURE__ */ v(ae, { variant: "primary", onClick: () => L(!0), children: s.tokens.newToken })
        ] }),
        g === "members" && /* @__PURE__ */ v(
          Zn,
          {
            organizationId: e,
            members: p,
            loading: h,
            error: F,
            userRole: r,
            onInvite: () => Z(!0),
            onRetry: N,
            onRoleChange: async (x, E) => {
              await a.updateMemberRole(e, x, E), await N(), o == null || o();
            },
            onRemove: async (x) => {
              await a.removeMember(e, x), await N(), o == null || o();
            }
          }
        ),
        g === "pending" && /* @__PURE__ */ v(
          tr,
          {
            invitations: H,
            loading: k,
            error: T,
            userRole: r,
            onRetry: C,
            onResend: async (x) => {
              await a.resendInvitation(e, x);
            },
            onRevoke: async (x) => {
              await a.revokeInvitation(e, x);
            }
          }
        ),
        g === "tokens" && /* @__PURE__ */ v(
          gr,
          {
            tokens: d,
            loading: m,
            error: R,
            onRetry: q,
            onRevoke: async (x) => {
              await a.revokeToken(x), await q();
            }
          }
        ),
        /* @__PURE__ */ v(
          dr,
          {
            open: D,
            onClose: () => Z(!1),
            onInvite: (x, E) => a.invite(e, x, E),
            onBulkInvite: (x) => a.bulkInvite(e, x),
            onSuccess: () => {
              C(), N();
            }
          }
        ),
        /* @__PURE__ */ v(
          hr,
          {
            open: oe,
            onClose: () => L(!1),
            ownerType: t ? "user" : "org",
            ownerId: t ?? e,
            orgId: e,
            onCreate: (x) => a.createToken(x),
            onCreated: () => q()
          }
        )
      ]
    }
  );
}
export {
  wr as ALL_SCOPES,
  Fe as EmptyState,
  _t as HttpClient,
  Xt as HttpError,
  Kt as IdentityI18nProvider,
  _r as IdentityPage,
  dr as InviteModal,
  Zn as MembersTable,
  tr as PendingInvitesList,
  cr as RevokeConfirmDialog,
  Wn as RoleSelect,
  it as SCOPE_GROUPS,
  fr as ScopeSelector,
  hr as TokenCreateModal,
  gr as TokenList,
  Yt as createIdentityClient,
  Qt as createTokensClient,
  Ce as useIdentityI18n
};
