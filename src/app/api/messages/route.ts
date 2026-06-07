import { createMessage, listMessages, normalizeRoom, validateChatPayload } from "@/lib/chat";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const room = normalizeRoom(url.searchParams.get("room"));
    const limit = Number(url.searchParams.get("limit") ?? "60");
    const messages = await listMessages(room, limit);

    return Response.json({ room, messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load messages.";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const payload = validateChatPayload(body);
    const message = await createMessage(payload);

    return Response.json({ ok: true, message }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send message.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
