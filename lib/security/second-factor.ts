import "server-only";

import { createHash, randomBytes, randomInt } from "node:crypto";
import { appendFileSync } from "node:fs";
import { cookies } from "next/headers";
import { createClient as createBareClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { trackServer } from "@/lib/mixpanel-server";
import { enviarAvisoAlDueno } from "@/lib/whatsapp/send";
import { sendEmail } from "@/lib/email/resend";
import { NOT_ME_TOKEN_HOURS, templateSafe, whenText } from "@/lib/security/device-text";
import {
  CODE_LENGTH,
  CODE_TTL_MINUTES,
  LOGIN_TICKET_COOKIE,
  LOGIN_TICKET_MINUTES,
  codeEmail,
  maskEmail,
  maskPhone,
  purposeText,
  type CodeChannel,
  type CodePurpose,
} from "@/lib/security/code-text";

// THE SECOND FACTOR, SERVER SIDE (C1 of PL-22). Owner's decisions of 2026-11-05: a six-digit
// code by WhatsApp, email as the fallback, optional per shopkeeper, asked only from a device
// without the `sz_device` cookie and to change the password from inside the app. Migration
// 193 holds the codes; this file holds what talks to it, to Kapso and to Resend.
//
// THE CODE NEVER TOUCHES THE DATABASE. It is hashed with the owner's id; the row keeps the
// hash and a second secret, the ticket, which the browser carries in a short cookie between
// «we sent it» and «I typed it». A resend must present the ticket (migration 193), so a
// forged cookie naming another owner cannot open a chain of guesses.
//
// NEVER A SESSION BEFORE THE CODE. The password is checked with a bare client whose session
// is thrown away at once (`admin.signOut`), and the real session is minted only after the
// code passes, with the magic-link + verifyOtp pair the QA suites already use. There is no
// half-open session a thief could use while the code is pending.
//
// BUSINESS QUESTIONS, owner's words of 2026-11-05 (*«¿cuándo pedir el código?»*):
//   `Second Factor Code Sent` / `Verified` / `Rejected` say how often the factor fires, on
//   which channel, and how often it fails — if `Rejected` with `expired` grows, WhatsApp is
//   arriving late and the ten minutes are short; if `locked` grows, somebody is guessing.
//   `Second Factor Enabled` / `Disabled` say whether the optional factor is adopted at all;
//   if almost nobody turns it on after six months, the moment it is offered (PL-22) is wrong.
//   Filed under the owner, from the server: exact counts, never a floor.

const QA_LOG_DEV_REF = "vzqppwrwnmlbrxizskdh";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashCode(code: string, ownerId: string): string {
  return sha256(`${code}:${ownerId}`);
}

export function hashTicket(ticket: string): string {
  return sha256(`ticket:${ticket}`);
}

function newCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

function newTicket(): string {
  return randomBytes(24).toString("base64url");
}

// DEV ONLY. With `SECOND_FACTOR_QA_LOG=<file>` and the dev branch as the database, every
// code sent is appended to that file so `qa:segundo-factor` and a browser walk can read it
// without a phone. Refuses to write against any other project, whatever the variable says.
function qaLog(entry: Record<string, unknown>): void {
  const file = process.env.SECOND_FACTOR_QA_LOG;
  if (!file || !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(QA_LOG_DEV_REF)) return;
  try {
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // Never a reason to fail a send.
  }
}

// DEV ONLY. `SECOND_FACTOR_WHATSAPP=fake` skips Kapso and counts the WhatsApp as delivered,
// so the screens can be walked before Meta approves the template. Honoured only when the
// database is the dev branch: on any other project the variable is ignored, whatever it says.
function fakeWhatsapp(): boolean {
  return process.env.SECOND_FACTOR_WHATSAPP === "fake" && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(QA_LOG_DEV_REF));
}

export type SendCodeResult =
  | { ok: true; channel: CodeChannel; target: string; ticket: string }
  | { ok: false; code: "too_many" | "bad_ticket" | "send_failed" | "no_target" | "error" };

/**
 * Creates a code for this owner and purpose and delivers it. `prevTicket` is required on a
 * resend (see the header). On WhatsApp the delivery is Meta's authentication template
 * `login_code`; on email, Resend, plain text, no links.
 */
export async function sendCode(opciones: {
  ownerId: string;
  email: string | null;
  purpose: CodePurpose;
  channel: CodeChannel;
  target: string | null;
  ownerCountry?: string | null;
  prevTicket?: string | null;
}): Promise<SendCodeResult> {
  const { ownerId, purpose, channel } = opciones;
  const target = (opciones.target ?? "").trim();
  if (!target) return { ok: false, code: "no_target" };

  const code = newCode();
  // THE TICKET EXISTS ONLY FOR SIGN-IN. It is the secret a browser with no session carries
  // in the ten-minute cookie; every other purpose runs inside a session (or behind the
  // admin's guard), which already says whose code it is. A ticket stored for those would
  // make `verify_login_code` refuse the code with `bad_ticket` — found on the first browser
  // walk, 2026-11-05.
  const ticket = purpose === "login" ? newTicket() : null;
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("create_login_code", {
    p_owner_id: ownerId,
    p_purpose: purpose,
    p_channel: channel,
    p_target: target,
    p_code_hash: hashCode(code, ownerId),
    p_ticket_hash: ticket ? hashTicket(ticket) : null,
    p_ttl_minutes: CODE_TTL_MINUTES,
    p_prev_ticket_hash: opciones.prevTicket ? hashTicket(opciones.prevTicket) : null,
  });
  if (error) {
    console.error("[segundo factor] create_login_code:", error.message);
    return { ok: false, code: "error" };
  }
  const r = data as { ok?: boolean; code?: string; id?: string } | null;
  if (!r?.ok) {
    const c = r?.code === "too_many" || r?.code === "bad_ticket" ? r.code : "error";
    return { ok: false, code: c };
  }

  let delivered = false;
  if (channel === "whatsapp" && fakeWhatsapp()) {
    // DEV ONLY (see fakeWhatsapp): Meta has not approved `login_code` yet, so a browser walk
    // on the dev branch pretends the WhatsApp left and reads the code from the QA log.
    delivered = true;
  } else if (channel === "whatsapp") {
    const envio = await enviarAvisoAlDueno({
      ownerId,
      to: target,
      plantilla: process.env.LOGIN_CODE_TEMPLATE ?? "login_code",
      // One row per code: the id is unique, so a retry of the same code never sends twice,
      // and a new code always may.
      periodKey: `code:${r.id}`,
      parametrosCuerpo: [{ nombre: "1", texto: code }],
      parametroBoton: { nombre: "1", texto: code },
      cuerpoPosicional: true,
    });
    delivered = envio.estado === "enviado";
  } else {
    const mail = codeEmail(code, purposeText(purpose));
    const envio = await sendEmail({
      to: target,
      subject: mail.subject,
      text: mail.text,
      idempotencyKey: `code:${r.id}`,
      tag: `codigo_${purpose}`,
    });
    delivered = envio.ok;
  }
  qaLog({ purpose, channel, target, code, delivered });

  if (!delivered) {
    // The row stays undelivered, so it can never be typed and the previous code still works.
    trackServer("Second Factor Code Rejected", ownerId, { purpose, reason: "send_failed", channel }, opciones.email);
    return { ok: false, code: "send_failed" };
  }
  const { data: live, error: liveError } = await supabase.rpc("mark_login_code_delivered", { p_id: r.id });
  if (liveError || live !== true) {
    console.error("[segundo factor] mark_login_code_delivered:", liveError?.message ?? String(live));
    return { ok: false, code: "error" };
  }
  trackServer("Second Factor Code Sent", ownerId, { purpose, channel }, opciones.email);
  return { ok: true, channel, target, ticket: ticket ?? "" };
}

export type VerifyCodeResult =
  | { ok: true; channel: CodeChannel; target: string }
  | { ok: false; code: "mismatch" | "expired" | "locked" | "none" | "bad_ticket" | "error"; attemptsLeft?: number; channel?: CodeChannel; target?: string };

export async function verifyCode(opciones: {
  ownerId: string;
  email: string | null;
  purpose: CodePurpose;
  code: string;
  ticket: string | null;
}): Promise<VerifyCodeResult> {
  const { ownerId, purpose } = opciones;
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("verify_login_code", {
    p_owner_id: ownerId,
    p_purpose: purpose,
    p_code_hash: hashCode(opciones.code, ownerId),
    p_ticket_hash: opciones.ticket ? hashTicket(opciones.ticket) : null,
  });
  if (error) {
    console.error("[segundo factor] verify_login_code:", error.message);
    return { ok: false, code: "error" };
  }
  const r = data as { ok?: boolean; code?: string; attempts_left?: number; channel?: CodeChannel; target?: string } | null;
  if (r?.ok) {
    trackServer("Second Factor Code Verified", ownerId, { purpose, channel: r.channel ?? "whatsapp" }, opciones.email);
    return { ok: true, channel: r.channel ?? "whatsapp", target: r.target ?? "" };
  }
  const code =
    r?.code === "mismatch" || r?.code === "expired" || r?.code === "locked" || r?.code === "none" || r?.code === "bad_ticket"
      ? r.code
      : "error";
  trackServer("Second Factor Code Rejected", ownerId, { purpose, reason: code }, opciones.email);
  return { ok: false, code, attemptsLeft: r?.attempts_left, channel: r?.channel, target: r?.target };
}

/** A verified code of this purpose in the last `minutes`: what a second request may rely on. */
export async function recentlyVerified(ownerId: string, purpose: CodePurpose, minutes: number): Promise<boolean> {
  const { data, error } = await createServiceClient().rpc("login_code_recently_verified", {
    p_owner_id: ownerId,
    p_purpose: purpose,
    p_minutes: minutes,
  });
  return !error && data === true;
}

// ── The password, checked without opening a session ────────────────────────

export type PasswordCheck = "ok" | "wrong" | "too_many" | "error";

/**
 * Checks the password against Auth with a throw-away client and revokes the session it
 * minted. Five tries per owner and fifteen minutes: a thief with an open session must not
 * be able to guess the password from inside the app.
 */
export async function verifyPassword(ownerId: string, email: string, password: string): Promise<PasswordCheck> {
  if (!password) return "wrong";
  const service = createServiceClient();
  const { data: allowed, error: quotaError } = await service.rpc("claim_rate_limit_quota", {
    p_key: `password:${ownerId}`,
    p_limit: 5,
    p_window_seconds: 15 * 60,
  });
  if (quotaError) {
    console.error("[segundo factor] claim_rate_limit_quota:", quotaError.message);
    return "error";
  }
  if (allowed === false) return "too_many";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return "error";
  const bare = createBareClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await bare.auth.signInWithPassword({ email, password });
  if (error || !data.session) return "wrong";
  if (data.user?.id !== ownerId) return "wrong";
  try {
    await service.auth.admin.signOut(data.session.access_token, "local");
  } catch (e) {
    // The throw-away session dies on its own in an hour; worth a log, never a failure.
    console.error("[segundo factor] signOut of the check session:", e instanceof Error ? e.message : e);
  }
  return "ok";
}

// ── The real session, minted only after the code ───────────────────────────

/**
 * Signs the browser in as this email without a password: a magic link generated by the
 * server and verified at once by the cookie-bearing client. Returns the user id, or null.
 */
export async function issueSession(email: string): Promise<{ id: string; email: string | null } | null> {
  const service = createServiceClient();
  const { data: link, error } = await service.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link?.properties?.hashed_token) {
    console.error("[segundo factor] generateLink:", error?.message);
    return null;
  }
  const supabase = await createClient();
  const { data, error: otpError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (otpError || !data.user) {
    console.error("[segundo factor] verifyOtp:", otpError?.message);
    return null;
  }
  return { id: data.user.id, email: data.user.email ?? null };
}

// ── The login ticket cookie ────────────────────────────────────────────────
//
// What the browser keeps between «we sent it» and «I typed it». httpOnly, ten minutes,
// refreshed on every resend. Holds the owner's id (so the code screen knows whose code),
// the ticket (the secret migration 193 checks), the channel and a MASKED target (what the
// screen shows), and how many resends there were (the email fallback appears after one).
// Surviving a reload is the point: on an iPhone, switching to WhatsApp and back often
// reloads the page, and without this the owner would be back at the password.

export type LoginTicket = {
  ownerId: string;
  email: string;
  ticket: string;
  channel: CodeChannel;
  masked: string;
  resends: number;
  // Where the real target lives for a resend: the number and the address, never shown.
  whatsapp: string | null;
  ownerCountry: string | null;
};

export async function setLoginTicket(t: LoginTicket): Promise<void> {
  const jar = await cookies();
  jar.set(LOGIN_TICKET_COOKIE, Buffer.from(JSON.stringify(t)).toString("base64url"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LOGIN_TICKET_MINUTES * 60,
  });
}

export async function readLoginTicket(): Promise<LoginTicket | null> {
  try {
    const raw = (await cookies()).get(LOGIN_TICKET_COOKIE)?.value;
    if (!raw) return null;
    const t = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as LoginTicket;
    if (!t?.ownerId || !t.ticket || !t.email) return null;
    return t;
  } catch {
    return null;
  }
}

export async function clearLoginTicket(): Promise<void> {
  (await cookies()).set(LOGIN_TICKET_COOKIE, "", { path: "/", maxAge: 0 });
}

export function maskedTarget(channel: CodeChannel, target: string): string {
  return channel === "whatsapp" ? maskPhone(target) : maskEmail(target);
}

// ── Facts, the switch, the audit ───────────────────────────────────────────

export type SecurityFacts = {
  email: string;
  whatsapp: string | null;
  ownerCountry: string | null;
  secondFactor: boolean;
  knownDevices: number;
};

export async function securityFacts(ownerId: string): Promise<SecurityFacts | null> {
  const { data, error } = await createServiceClient().rpc("owner_security_facts", { p_owner_id: ownerId });
  if (error || !data) {
    if (error) console.error("[segundo factor] owner_security_facts:", error.message);
    return null;
  }
  const r = data as { email?: string; whatsapp?: string | null; owner_country?: string | null; second_factor?: boolean; known_devices?: number };
  return {
    email: r.email ?? "",
    whatsapp: r.whatsapp ?? null,
    ownerCountry: r.owner_country ?? null,
    secondFactor: r.second_factor === true,
    knownDevices: r.known_devices ?? 0,
  };
}

export async function setSecondFactor(ownerId: string, enabled: boolean): Promise<boolean> {
  const { error } = await createServiceClient().rpc("set_second_factor", { p_owner_id: ownerId, p_enabled: enabled });
  if (error) console.error("[segundo factor] set_second_factor:", error.message);
  return !error;
}

/** Whether the caller's own account has the factor on. Session client, `my_second_factor`. */
export async function mySecondFactor(supabase: { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> }): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("my_second_factor");
    if (error) return false;
    return (data as { enabled?: boolean } | null)?.enabled === true;
  } catch {
    return false;
  }
}

export async function logSecurityAudit(ownerId: string, action: string, actor: string, detail: Record<string, unknown>): Promise<void> {
  const { error } = await createServiceClient().rpc("log_security_audit", {
    p_owner_id: ownerId,
    p_action: action,
    p_actor: actor,
    p_detail: detail,
  });
  if (error) console.error("[segundo factor] log_security_audit:", error.message);
}

// ── «Your number / your email changed» ─────────────────────────────────────
//
// Approved by the owner on 2026-11-05: the shopkeeper learns by WhatsApp when the number or
// the email of the account changes, with the same one-use «No fui yo» button as the new-
// device alert. For a number change it goes to the OLD number — the one a thief would have
// replaced. Behind `ACCOUNT_CHANGE_ALERTS=on` until Meta approves `account_change_alert`.
//
// BUSINESS QUESTION: «¿cuántos cambios de número o de correo no los hizo el dueño?». If
// `Session Revoked By Owner` ever follows one of these, the password alone was not enough
// and the password-only rule for changing the number (owner's decision) needs revisiting.

export async function notifyAccountChange(opciones: {
  ownerId: string;
  email: string | null;
  to: string | null;
  ownerCountry: string | null;
  what: "number" | "email";
  newValueMasked: string;
}): Promise<boolean> {
  if (process.env.ACCOUNT_CHANGE_ALERTS !== "on" || !opciones.to) return false;
  try {
    const service = createServiceClient();
    const token = randomBytes(24).toString("base64url");
    const { error } = await service.rpc("create_not_me_token", {
      p_owner_id: opciones.ownerId,
      p_token_hash: sha256(token),
      p_ttl_hours: NOT_ME_TOKEN_HOURS,
    });
    if (error) {
      console.error("[cambio de cuenta] create_not_me_token:", error.message);
      return false;
    }
    const now = new Date().toISOString();
    const envio = await enviarAvisoAlDueno({
      ownerId: opciones.ownerId,
      to: opciones.to,
      plantilla: "account_change_alert",
      periodKey: `${opciones.what}:${now}`,
      parametrosCuerpo: [
        { nombre: "what", texto: opciones.what === "number" ? "el número de WhatsApp" : "el correo" },
        { nombre: "new_value", texto: templateSafe(opciones.newValueMasked) },
        { nombre: "when", texto: templateSafe(whenText(now, opciones.ownerCountry)) },
      ],
      parametroBoton: { nombre: "1", texto: token },
    });
    const sent = envio.estado === "enviado";
    if (sent) trackServer("Account Change Alert Sent", opciones.ownerId, { what: opciones.what }, opciones.email);
    return sent;
  } catch (e) {
    console.error("[cambio de cuenta]:", e instanceof Error ? e.message : e);
    return false;
  }
}
