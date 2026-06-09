export interface Message {
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  usage?: TokenUsage;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  cost: number;
}

export interface SessionMeta {
  path: string;
  name: string;
  date: string;
  tokenCount: number;
  messageCount: number;
  model: string;
}

export interface SessionData {
  meta: SessionMeta;
  messages: Message[];
}

export interface ModelInfo {
  provider: string;
  modelId: string;
  name: string;
}

export type Lang = "zh" | "en";

export type ThemeMode = "light" | "dark" | "auto";
export type ExportFormat = "txt" | "md" | "html";
export type Page = "loading" | "setup" | "chat";
