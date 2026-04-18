// Pure chat-session helpers to keep ChatMode UI logic short and readable.
import type { Dispatch, SetStateAction } from "react";
import {
  createSession,
  deleteSession,
  getSession,
  updateSession,
} from "@/utils/api";
import type { AIResponse, ChatSession, Message } from "@/types";

interface SaveSessionParams {
  token: string;
  isGuest: boolean;
  query: string;
  activeSessionId: string | null;
  finalMessages: Message[];
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  setSessions: Dispatch<SetStateAction<ChatSession[]>>;
}

export function buildHistoryFromMessages(messages: Message[]) {
  return messages.map((message) => ({
    role: message.role,
    content:
      message.role === "user"
        ? message.content
        : JSON.stringify(message.content),
  }));
}

export function buildAssistantError(message: string): AIResponse {
  return {
    error: `Error: ${message}`,
    charts: [],
    followUps: [],
  };
}

function buildSessionTitle(query: string) {
  return query.slice(0, 60) + (query.length > 60 ? "…" : "");
}

export async function saveSessionAfterReply(params: SaveSessionParams) {
  const {
    token,
    isGuest,
    query,
    activeSessionId,
    finalMessages,
    setActiveSessionId,
    setSessions,
  } = params;

  if (isGuest) return;

  if (!activeSessionId) {
    const session = await createSession(token, buildSessionTitle(query));
    setActiveSessionId(session.id);
    await updateSession(token, session.id, {
      messages: finalMessages as unknown[],
    });
    setSessions((previous) => [
      {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      ...previous,
    ]);
    return;
  }

  await updateSession(token, activeSessionId, {
    messages: finalMessages as unknown[],
  });
  setSessions((previous) =>
    previous.map((session) =>
      session.id === activeSessionId
        ? { ...session, updatedAt: new Date().toISOString() }
        : session,
    ),
  );
}

export async function fetchSession(token: string, sessionId: string) {
  return getSession(token, sessionId);
}

export async function removeSessionFromApi(token: string, sessionId: string) {
  await deleteSession(token, sessionId).catch(() => {});
}
