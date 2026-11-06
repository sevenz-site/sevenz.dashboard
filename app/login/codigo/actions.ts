"use server";

import { landingAfterLogin } from "@/lib/auth/landing-after-login";
import { redirect } from "next/navigation";
import { trackServer } from "@/lib/mixpanel-server";
import { recordLoginDevice } from "@/lib/security/new-device";
import {
  clearLoginTicket,
  issueSession,
  maskedTarget,
  readLoginTicket,
  sendCode,
  setLoginTicket,
  verifyCode,
} from "@/lib/security/second-factor";
import { normalizeCode, rejectionText, sentToText } from "@/lib/security/code-text";

// THE CODE SCREEN'S TWO ACTIONS (C1 of PL-22). Both read the ten-minute ticket cookie the
// password step left; without it there is nothing to verify and the browser goes back to
// /login. Every outcome has its own sentence on screen — the owner's rule of 2026-11-05.

export type CodeState = {
  error: string | null;
  // A fact to show in green, not red: «te enviamos uno nuevo».
  notice: string | null;
};

export async function verifyLoginCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const ticket = await readLoginTicket();
  if (!ticket) redirect("/login");

  const code = normalizeCode(String(formData.get("code") ?? ""));
  if (!code) return { error: "Escribe los 6 dígitos del código.", notice: null };

  const result = await verifyCode({ ownerId: ticket.ownerId, email: ticket.email, purpose: "login", code, ticket: ticket.ticket });

  if (result.ok) {
    const user = await issueSession(ticket.email);
    if (!user) return { error: "No pudimos abrir tu sesión. Vuelve a entrar con tu contraseña.", notice: null };
    await clearLoginTicket();
    const device = await recordLoginDevice({ id: user.id, email: user.email });
    trackServer("Login Completed", user.id, { new_device: device.isNew, second_factor: true }, user.email);
    redirect(await landingAfterLogin());
  }

  if (result.code === "expired") {
    // «Ese código caducó. Te enviamos uno nuevo.» — on the same channel, same chain.
    const sent = await sendCode({
      ownerId: ticket.ownerId,
      email: ticket.email,
      purpose: "login",
      channel: ticket.channel,
      target: ticket.channel === "whatsapp" ? ticket.whatsapp : ticket.email,
      ownerCountry: ticket.ownerCountry,
      prevTicket: ticket.ticket,
    });
    if (!sent.ok) return { error: `Ese código caducó. ${rejectionText(sent.code)}`, notice: null };
    await setLoginTicket({ ...ticket, ticket: sent.ticket, resends: ticket.resends + 1 });
    return { error: null, notice: rejectionText("expired") };
  }

  return { error: rejectionText(result.code, result.attemptsLeft), notice: null };
}

export async function resendLoginCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const ticket = await readLoginTicket();
  if (!ticket) redirect("/login");

  const toEmail = String(formData.get("channel") ?? "") === "email";
  const channel = toEmail ? "email" : ticket.channel;
  const target = channel === "whatsapp" ? ticket.whatsapp : ticket.email;

  const sent = await sendCode({
    ownerId: ticket.ownerId,
    email: ticket.email,
    purpose: "login",
    channel,
    target,
    ownerCountry: ticket.ownerCountry,
    prevTicket: ticket.ticket,
  });
  if (!sent.ok) return { error: rejectionText(sent.code), notice: null };

  await setLoginTicket({
    ...ticket,
    ticket: sent.ticket,
    channel: sent.channel,
    masked: maskedTarget(sent.channel, sent.target),
    resends: ticket.resends + 1,
  });
  return { error: null, notice: sentToText(sent.channel, sent.target) };
}

export async function abandonLoginCode(): Promise<void> {
  await clearLoginTicket();
  redirect("/login");
}
