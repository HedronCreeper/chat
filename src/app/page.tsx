import ChatApp from "@/components/chat-app";
import { listMessages } from "@/lib/chat";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initialMessages = await listMessages();

  return <ChatApp room="global" initialMessages={initialMessages} />;
}
