import { notFound } from "next/navigation";

// Closed until a client can prove who they are.
//
// This page showed a client's document, WhatsApp number and address to anyone
// holding the share link — and a share link travels through forwarded chats and
// WhatsApp groups, so "anyone holding it" is a far wider set than the one person
// it was sent to. Name plus cédula plus phone is most of what someone needs to
// sound convincing while pretending to be the shop.
//
// Nothing in the app linked here; it was reachable only by typing the URL, which
// is exactly the access worth removing while it earns nothing.
//
// notFound() before any fetch, so no lookup happens at all: a caller cannot use
// response timing or a redirect target to learn whether a token is real.
//
// Blocking the page alone would have been theatre. The other two doors are shut
// with it — get_shared_client_profile() no longer grants execute to anon (see
// supabase/041_close_public_client_profile.sql), and uploadProfilePicture()
// refuses in app/s/[token]/actions.ts. A route guard that leaves the server
// action live protects nothing.
//
// The full page is intact in git as of 076867c and should be restored from
// there, behind the authentication check, rather than rebuilt from memory.
export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await params;
  notFound();
}
