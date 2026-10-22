import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import type { AgentKind, HarnessEvent, PermissionMode } from "../types";

export type ConnectionInfo = {
  cwd: string;
  previewUrl: string;
  agent: AgentKind;
  agents: AgentKind[];
  model: string;
  mode: PermissionMode;
  production: boolean;
  running: boolean;
};

export type RunAck = {
  ok?: boolean;
  error?: string;
  sessionId?: string;
};

export type ServerToClientEvents = {
  connection: (info: ConnectionInfo) => void;
  harness: (event: HarnessEvent) => void;
};

export type ClientToServerEvents = {
  run: (
    payload: {
      prompt: string;
      agent: AgentKind;
      sessionId: string | null;
      model: string;
      permissionMode: PermissionMode;
      attachments?: Array<{ name: string; mime: string; data: string }>;
    },
    ack?: (result: RunAck) => void,
  ) => void;
  stop: () => void;
};

/** Same origin as the page, so no CORS or URL configuration is needed. */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();
