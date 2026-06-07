"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import type { ChatMessageView } from "@/lib/chat";

const ROOM_LABEL = "Global room";
const STORAGE_KEY = "arena-global-chat-username";
const FETCH_LIMIT = 60;
const AUTO_REFRESH_MS = 3000;

const STOP_WORDS = new Set([
  "the",
  "and",
  "that",
  "with",
  "this",
  "from",
  "have",
  "your",
  "you",
  "are",
  "for",
  "not",
  "but",
  "can",
  "will",
  "just",
  "about",
  "what",
  "when",
  "where",
  "who",
  "why",
  "how",
  "here",
  "there",
  "they",
  "them",
  "our",
  "out",
  "into",
  "all",
  "any",
  "too",
  "was",
  "were",
  "has",
  "had",
  "been",
  "i",
  "me",
  "my",
  "we",
  "us",
  "if",
  "so",
  "do",
  "does",
  "did",
]);

type ConversationInsight = {
  activeSpeaker: string;
  likelyTopic: string;
  tone: string;
};

type ChatAppProps = {
  room: string;
  initialMessages: ChatMessageView[];
};

function deriveConversationInsights(messages: ChatMessageView[]): ConversationInsight {
  if (messages.length === 0) {
    return {
      activeSpeaker: "No one yet",
      likelyTopic: "Introductions",
      tone: "Waiting for the first message",
    };
  }

  const speakerCounts = new Map<string, number>();
  const keywordCounts = new Map<string, number>();
  let energeticSignals = 0;

  for (const message of messages) {
    speakerCounts.set(message.username, (speakerCounts.get(message.username) ?? 0) + 1);

    const words = message.content.toLowerCase().match(/[a-z0-9']+/g) ?? [];
    for (const word of words) {
      if (word.length < 4 || STOP_WORDS.has(word)) {
        continue;
      }
      keywordCounts.set(word, (keywordCounts.get(word) ?? 0) + 1);
    }

    if (/[!?]{2,}/.test(message.content) || /\b(lol|awesome|great|nice|yay|woo)\b/i.test(message.content)) {
      energeticSignals += 1;
    }
  }

  const activeSpeaker = [...speakerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Everyone";
  const likelyTopic = [...keywordCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "general chat";
  const tone = energeticSignals >= Math.max(2, Math.floor(messages.length / 3)) ? "Energetic and lively" : "Calm and focused";

  return { activeSpeaker, likelyTopic, tone };
}

function formatTimestamp(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function ChatApp({ room, initialMessages }: ChatAppProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [username, setUsername] = useState("Guest");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Live");
  const [isSending, setIsSending] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const savedUsername = window.localStorage.getItem(STORAGE_KEY);
    if (savedUsername) {
      setUsername(savedUsername);
    }
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, username);
  }, [isReady, username]);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    const syncMessages = async () => {
      try {
        const response = await fetch(`/api/messages?room=${encodeURIComponent(room)}&limit=${FETCH_LIMIT}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Unable to refresh messages right now.");
        }

        const data = (await response.json()) as { messages?: ChatMessageView[] };
        if (!cancelled) {
          setMessages(data.messages ?? []);
          setStatus(`Synced ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
        }
      } catch {
        if (!cancelled) {
          setStatus("Reconnecting…");
        }
      }
    };

    void syncMessages();
    timeoutId = window.setInterval(syncMessages, AUTO_REFRESH_MS);

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearInterval(timeoutId);
      }
    };
  }, [room]);

  const insights = useMemo(() => deriveConversationInsights(messages), [messages]);
  const participants = useMemo(() => new Set(messages.map((message) => message.username)).size, [messages]);
  const latestMessage = messages[messages.length - 1];

  async function sendMessage() {
    const trimmedDraft = draft.trim();
    const trimmedUsername = username.trim();

    if (!trimmedDraft || !trimmedUsername) {
      setError("Pick a name and type a message first.");
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ room, username: trimmedUsername, content: trimmedDraft }),
      });

      const data = (await response.json()) as { ok?: boolean; message?: ChatMessageView; error?: string };
      const sentMessage = data.message;

      if (!response.ok || !data.ok || !sentMessage) {
        throw new Error(data.error || "Message could not be sent.");
      }

      setDraft("");
      setMessages((current) => {
        const next = [...current.filter((message) => message.id !== sentMessage.id), sentMessage];
        return next.slice(-FETCH_LIMIT);
      });
      setStatus("Message sent");
      textAreaRef.current?.focus();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Something went wrong.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendMessage();
  }

  return (
    <div className="grid min-h-screen gap-6 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_36%),linear-gradient(180deg,_#07111f_0%,_#0f172a_100%)] px-4 py-6 text-slate-50 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[1.1fr_1.9fr]">
        <aside className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-300" />
            {status}
          </div>

          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Global chat for the whole world.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-slate-300 sm:text-base">
            Jump into a shared public room, keep your name saved on this device, and watch new messages appear automatically.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Messages</p>
              <p className="mt-2 text-2xl font-semibold text-white">{messages.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Participants</p>
              <p className="mt-2 text-2xl font-semibold text-white">{participants}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Room</p>
              <p className="mt-2 text-lg font-semibold text-white">{room}</p>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Smart room pulse</p>
            <dl className="mt-4 space-y-4 text-sm text-slate-100">
              <div>
                <dt className="text-slate-400">Most active speaker</dt>
                <dd className="mt-1 font-medium">{insights.activeSpeaker}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Likely topic</dt>
                <dd className="mt-1 font-medium">{insights.likelyTopic}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Tone</dt>
                <dd className="mt-1 font-medium">{insights.tone}</dd>
              </div>
            </dl>
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Your name</p>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              maxLength={24}
              className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500 focus:border-cyan-400/50"
              placeholder="Enter a display name"
            />
            <p className="mt-3 text-xs leading-5 text-slate-400">
              Your name is saved locally, so you can come back without retyping it.
            </p>
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Quick starters</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                "Hello everyone 👋",
                "Where are you joining from?",
                "What are you building today?",
                "Drop a fun fact!",
              ].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setDraft(prompt)}
                  className="rounded-full border border-white/10 bg-slate-950/50 px-3 py-2 text-left text-xs text-slate-200 transition hover:border-cyan-400/50 hover:bg-cyan-400/10"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="flex min-h-[75vh] flex-col rounded-[2rem] border border-white/10 bg-slate-950/65 shadow-2xl shadow-slate-950/50 backdrop-blur-xl">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5 sm:px-8">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Public room</p>
              <h2 className="mt-1 text-2xl font-semibold text-white">{ROOM_LABEL}</h2>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
              Auto-refresh every {AUTO_REFRESH_MS / 1000}s
            </div>
          </header>

          <div className="flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-6">
            <div className="h-full overflow-y-auto rounded-[1.5rem] border border-white/10 bg-slate-900/60 p-4 sm:p-6">
              {messages.length === 0 ? (
                <div className="grid min-h-[24rem] place-items-center rounded-[1.5rem] border border-dashed border-white/10 bg-white/5 p-8 text-center">
                  <div>
                    <p className="text-lg font-semibold text-white">Be the first to say hello.</p>
                    <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
                      This public room is live now. Your message will be saved to the database and shared with everyone who opens the app.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((message) => {
                    const isYou = message.username === username.trim();
                    return (
                      <article
                        key={message.id}
                        className={`flex gap-3 rounded-3xl border p-4 transition ${
                          isYou
                            ? "border-cyan-400/30 bg-cyan-400/10"
                            : "border-white/10 bg-white/5"
                        }`}
                      >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 text-sm font-semibold text-slate-950">
                          {message.username.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <p className="font-medium text-white">{message.username}</p>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                              {formatTimestamp(message.createdAt)}
                            </p>
                            {isYou ? (
                              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
                                You
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
                            {message.content}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="border-t border-white/10 px-4 py-4 sm:px-6 sm:py-5">
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 sm:p-5">
              <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-400" htmlFor="message-draft">
                Message
              </label>
              <textarea
                id="message-draft"
                ref={textAreaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (!isSending) {
                      void sendMessage();
                    }
                  }
                }}
                maxLength={500}
                rows={3}
                className="w-full resize-none rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/50"
                placeholder="Share something with the world..."
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-400">
                  Press <span className="font-medium text-slate-200">Enter</span> to send, <span className="font-medium text-slate-200">Shift+Enter</span> for a new line.
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {error ? <p className="text-sm text-rose-300">{error}</p> : null}
                  <button
                    type="submit"
                    disabled={isSending}
                    className="inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSending ? "Sending…" : "Send message"}
                  </button>
                </div>
              </div>
            </div>
          </form>

          <footer className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 text-xs text-slate-400 sm:px-8">
            <p>
              Database-backed, live-updating, and safe for the public internet.
            </p>
            <p>
              Latest activity: {latestMessage ? `${latestMessage.username} at ${formatTimestamp(latestMessage.createdAt)}` : "No messages yet"}
            </p>
          </footer>
        </section>
      </div>
    </div>
  );
}
