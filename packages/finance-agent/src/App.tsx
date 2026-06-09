import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { Message, SessionMeta, ModelInfo, ThemeMode, Page, Lang } from "./types";
import { t } from "./i18n";
import Sidebar from "./Sidebar";
import ExportDialog from "./ExportDialog";
import TokenUsage from "./TokenUsage";

// ── Simple Markdown renderer (no external deps) ──

function simpleMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^### (.+)/gm, "<h3>$1</h3>")
    .replace(/^## (.+)/gm, "<h2>$1</h2>")
    .replace(/^# (.+)/gm, "<h1>$1</h1>")
    .replace(/^- (.+)/gm, "<li>$1</li>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(.+)$/gm, (m) => m.startsWith("<") ? m : `<span>${m}</span>`);
}

function MarkdownBlock({ content }: { content: string }) {
  const html = useMemo(() => simpleMarkdown(content), [content]);
  return <div dangerouslySetInnerHTML={{ __html: html }} style={{ lineHeight: 1.6, fontSize: 14 }} />;
}

// ── Collapsible thinking ──

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 8, borderRadius: 6, border: "1px solid #e0e0e0", overflow: "hidden" }}>
      <div onClick={() => setOpen(!open)}
        style={{ padding: "6px 10px", background: "#fafafa", cursor: "pointer", fontSize: 12, color: "#888", display: "flex", alignItems: "center", gap: 6, userSelect: "none" }}>
        <span style={{ fontSize: 10 }}>{open ? "▼" : "▶"}</span>Thinking
      </div>
      {open && <div style={{ padding: "8px 10px", fontSize: 12, color: "#666", background: "#fefefe", whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: 200, overflowY: "auto" }}>{content}</div>}
    </div>
  );
}

// ── Message bubble ──

function MessageBubble({ msg, isLast, onRegen, onBranch }: { msg: Message; isLast?: boolean; onRegen?: () => void; onBranch?: () => void }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ marginBottom: 12, maxWidth: "85%", marginLeft: isUser ? "auto" : 0, marginRight: isUser ? 0 : "auto" }}>
      <div style={{ borderRadius: 10, padding: "10px 14px", background: isUser ? "var(--msg-user, #e3f2fd)" : "var(--msg-assistant, #f5f5f5)" }}
        onMouseEnter={(e) => { const b = e.currentTarget.querySelector(".branch-btn") as HTMLElement; if (b) b.style.display = "inline"; }}
        onMouseLeave={(e) => { const b = e.currentTarget.querySelector(".branch-btn") as HTMLElement; if (b) b.style.display = "none"; }}>
        {!isUser && msg.thinking && <ThinkingBlock content={msg.thinking} />}
        {isUser ? (
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5 }}>{msg.text}</div>
        ) : (
          <>
            <MarkdownBlock content={msg.text} />
            <TokenUsage usage={(msg as any).usage} />
            <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
              {onRegen && <span onClick={onRegen} style={{ fontSize: 12, color: "#999", cursor: "pointer" }}>↻</span>}
              {!isLast && onBranch && <span className="branch-btn" onClick={onBranch} style={{ fontSize: 12, color: "#999", cursor: "pointer", display: "none" }}>↪</span>}
            </div>
          </>
        )}
        {isUser && !isLast && onBranch && (
          <span className="branch-btn" onClick={onBranch} style={{ fontSize: 12, color: "#999", cursor: "pointer", display: "none" }}>↪</span>
        )}
      </div>
    </div>
  );
}

// ── Providers config ──

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI (GPT)" },
  { id: "google", label: "Google (Gemini)" },
  { id: "mistral", label: "Mistral" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "groq", label: "Groq" },
  { id: "openrouter", label: "OpenRouter" },
] as const;

// ── About modal ──

function AboutDialog({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("…");
  const [dataDir, setDataDir] = useState("…");
  useEffect(() => {
    invoke<string>("get_app_version").then(setVersion).catch(() => {});
    invoke<string>("get_data_dir_path").then(setDataDir).catch(() => {});
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", maxWidth: 400, width: "90%", boxShadow: "0 4px 24px rgba(0,0,0,0.15)", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Finance Agent</h2>
        <p style={{ margin: "0 0 16px", color: "#666", fontSize: 13 }}>Version {version}</p>
        <p style={{ margin: "0 0 8px", fontSize: 13, color: "#555" }}>Built with <a href="https://github.com/earendil-works/pi" target="_blank" rel="noopener noreferrer" style={{ color: "#1976d2" }}>@earendil-works/agent-base</a></p>
        <button onClick={onClose} style={{ padding: "8px 24px", borderRadius: 6, border: "none", background: "#1976d2", color: "#fff", fontSize: 13, cursor: "pointer" }}>Close</button>
      </div>
    </div>
  );
}

// ── Setup page ──

function SetupPage({ onDone }: { onDone: () => void }) {
  const [provider, setProvider] = useState(PROVIDERS[0].id);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const handleSave = async () => {
    const trimmed = key.trim();
    if (!trimmed) { setError("Please enter an API key."); return; }
    setSaving(true); setError("");
    try { await invoke("save_api_key", { provider, key: trimmed }); onDone(); }
    catch (e) { setError(`Failed to save: ${e}`); }
    finally { setSaving(false); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", padding: 32, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ maxWidth: 480, width: "100%" }}>
        <h1 style={{ marginBottom: 8, fontSize: 24 }}>Welcome</h1>
        <p style={{ marginBottom: 24, color: "#666", fontSize: 14 }}>Choose your LLM provider and enter an API key.</p>
        <label style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 13 }}>Provider</label>
        <select value={provider} onChange={(e) => { setProvider(e.target.value); setError(""); }} style={{ width: "100%", padding: "10px 12px", marginBottom: 16, borderRadius: 6, border: "1px solid #ccc", fontSize: 14, background: "#fff" }}>
          {PROVIDERS.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
        </select>
        <label style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 13 }}>API Key</label>
        <input type="password" value={key} onChange={(e) => { setKey(e.target.value); setError(""); }} style={{ width: "100%", padding: "10px 12px", marginBottom: 12, borderRadius: 6, border: "1px solid #ccc", fontSize: 14, boxSizing: "border-box" }} />
        {error && <p style={{ color: "#d32f2f", fontSize: 13, marginBottom: 12 }}>{error}</p>}
        <button onClick={handleSave} disabled={saving} style={{ width: "100%", padding: "10px 0", borderRadius: 6, border: "none", background: saving ? "#90caf9" : "#1976d2", color: "#fff", fontSize: 14, fontWeight: 600, cursor: saving ? "default" : "pointer" }}>{saving ? "Saving…" : "Continue"}</button>
      </div>
    </div>
  );
}

// ── Menu bar ──

type MenuItem = { type: "action"; label: string; action: () => void } | { type: "separator" };
type MenuDef = { label: string; items: MenuItem[] };

function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openMenu === null) return;
    const handler = (e: MouseEvent) => { if (!barRef.current?.contains(e.target as Node)) setOpenMenu(null); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);
  return (
    <div ref={barRef} style={{ display: "flex", alignItems: "center", height: 32, background: "var(--bg-secondary, #f5f5f5)", borderBottom: "1px solid var(--border, #ddd)", userSelect: "none", fontFamily: "system-ui, -apple-system, sans-serif", fontSize: 13, position: "relative", flexShrink: 0 }}>
      {menus.map((menu, mi) => (
        <div key={mi} style={{ position: "relative" }}>
          <div onClick={() => setOpenMenu(openMenu === mi ? null : mi)} onMouseEnter={() => { if (openMenu !== null) setOpenMenu(mi); }} style={{ padding: "4px 10px", cursor: "pointer", borderRadius: 4, background: openMenu === mi ? "#e0e0e0" : "transparent", marginLeft: 2, color: "var(--text, #333)" }}>{menu.label}</div>
          {openMenu === mi && (
            <div style={{ position: "absolute", top: "100%", left: 0, minWidth: 180, background: "var(--bg, #fff)", border: "1px solid var(--border, #ccc)", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", padding: "4px 0", zIndex: 50 }}>
              {menu.items.map((item, ii) =>
                item.type === "separator" ? <div key={ii} style={{ height: 1, background: "var(--border, #e0e0e0)", margin: "4px 8px" }} />
                : <div key={ii} onClick={() => { setOpenMenu(null); item.action(); }} style={{ padding: "6px 16px", cursor: "pointer", fontSize: 13, color: "var(--text, #333)" }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "#f0f0f0"; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; }}>{item.label}</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Chat page ──

function ChatPage({ onConfigure }: { onConfigure: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [lastUserText, setLastUserText] = useState("");
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [systemPromptText, setSystemPromptText] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sidebar state
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [currentSessionPath, setCurrentSessionPath] = useState<string | undefined>();
  const [themeMode, setThemeMode] = useState<ThemeMode>("auto");
  const [lang, setLang] = useState<Lang>("zh");
  const [models] = useState<ModelInfo[]>([
    { provider: "deepseek", modelId: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { provider: "deepseek", modelId: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  ]);
  const [currentModel] = useState("deepseek/deepseek-v4-pro");

  // Load sessions
  const loadSessions = useCallback(async () => {
    try { setSessions(await invoke<SessionMeta[]>("list_sessions")); }
    catch { /* silent */ }
  }, []);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Restore settings on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = await invoke<string>("get_settings");
        const s = JSON.parse(raw);
        if (s.language) setLang(s.language);
        if (s.theme) setThemeMode(s.theme);
        if (s.last_session_path) setCurrentSessionPath(s.last_session_path);
        if (s.system_prompt) setSystemPromptText(s.system_prompt);
      } catch {}
    })();
  }, []);

  // Save settings when they change
  useEffect(() => {
    const timer = setTimeout(() => {
      invoke("save_settings", {
        json: JSON.stringify({
          language: lang,
          theme: themeMode,
          last_session_path: currentSessionPath,
          system_prompt: systemPromptText || undefined,
        }),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [lang, themeMode, currentSessionPath, systemPromptText]);

  // Dark mode CSS vars
  useEffect(() => {
    const root = document.documentElement;
    const isDark = themeMode === "dark" || (themeMode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.style.setProperty("--bg", isDark ? "#1e1e1e" : "#fff");
    root.style.setProperty("--bg-secondary", isDark ? "#2d2d2d" : "#f5f5f5");
    root.style.setProperty("--text", isDark ? "#ddd" : "#333");
    root.style.setProperty("--text-secondary", isDark ? "#999" : "#666");
    root.style.setProperty("--border", isDark ? "#444" : "#ddd");
    root.style.setProperty("--msg-user", isDark ? "#1a3a5c" : "#e3f2fd");
    root.style.setProperty("--msg-assistant", isDark ? "#2d2d2d" : "#f5f5f5");
    root.style.setProperty("--sidebar-bg", isDark ? "#252525" : "#fafafa");
  }, [themeMode]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, autoScroll]);

  // Focus input after loading
  useEffect(() => { if (!loading) inputRef.current?.focus(); }, [loading]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "E") { setShowExport(true); e.preventDefault(); }
      if (e.ctrlKey && e.key === "n") { newSession(); e.preventDefault(); }
      if (e.ctrlKey && e.key === ",") { onConfigure(); e.preventDefault(); }
      if (e.ctrlKey && e.shiftKey && e.key === "D") { toggleTheme(); e.preventDefault(); }
      if (e.ctrlKey && e.key === "f") { setSearchQuery(""); setSearchMatchIdx(0); e.preventDefault(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [newSession, onConfigure, toggleTheme]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
  }, []);

  const textRef = useRef("");
  const thinkingRef = useRef<string | undefined>(undefined);

  const updateMsg = (text: string, thinking?: string, usage?: any) => {
    setMessages((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = { role: "assistant", text, thinking, usage } as Message;
      return copy;
    });
  };

  const send = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userText = input;
    setLastUserText(userText);
    setInput("");
    setMessages((m) => [...m, { role: "user", text: userText }]);
    setLoading(true);
    textRef.current = "";
    thinkingRef.current = undefined;
    setMessages((m) => [...m, { role: "assistant", text: "Thinking…", thinking: undefined }]);

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<string>("stream:update", (e) => {
        try {
          const parsed = JSON.parse(e.payload);
          if (typeof parsed === "object") {
            textRef.current = parsed.text ?? textRef.current;
            thinkingRef.current = parsed.thinking ?? thinkingRef.current;
            updateMsg(textRef.current || "Thinking…", thinkingRef.current);
          }
        } catch { /* skip */ }
      });

      const raw = await invoke<string>("send_prompt", { text: userText });
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed.text !== undefined) {
          updateMsg(parsed.text, parsed.thinking, parsed.usage);
        }
      } catch { updateMsg(raw); }
    } catch (e) {
      updateMsg(`Error: ${e}`);
    } finally {
      unlisten?.();
      setLoading(false);
      loadSessions();
    }
  }, [input, loading, loadSessions]);

  // Session handlers
  const handleSelectSession = useCallback(async (path: string) => {
    setCurrentSessionPath(path);
    setMessages([]);
    // The sidecar will resume this session on next send
  }, []);

  const handleRenameSession = useCallback(async (path: string, name: string) => {
    await invoke("rename_session", { path, name });
    loadSessions();
  }, [loadSessions]);

  const handleDeleteSession = useCallback(async (path: string) => {
    await invoke("delete_session", { path });
    if (currentSessionPath === path) setCurrentSessionPath(undefined);
    loadSessions();
  }, [loadSessions, currentSessionPath]);

  const handleSwitchModel = useCallback(async (provider: string, modelId: string) => {
    await invoke("switch_model", { provider, modelId });
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeMode((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const toggleLang = useCallback(() => {
    setLang((l) => (l === "zh" ? "en" : "zh"));
  }, []);

  const newSession = useCallback(() => {
    setMessages([]);
    setCurrentSessionPath(undefined);
    inputRef.current?.focus();
  }, []);

  const handleRegen = useCallback(async () => {
    if (!lastUserText) return;
    setMessages((prev) => prev.slice(0, -1));
    setInput(lastUserText);
    setTimeout(() => send(), 0);
  }, [lastUserText, send]);

  const handleEditClick = useCallback((idx: number, text: string) => {
    setEditingMsgIdx(idx);
    setEditText(text);
  }, []);

  const handleEditSend = useCallback(async () => {
    if (editingMsgIdx === null) return;
    const newText = editText.trim();
    if (!newText) return;
    setMessages((prev) => [...prev.slice(0, editingMsgIdx), { role: "user", text: newText }]);
    setEditingMsgIdx(null);
    setInput(newText);
    setLastUserText(newText);
    setTimeout(() => send(), 0);
  }, [editingMsgIdx, editText, send]);

  const menus: MenuDef[] = [
    { label: "File", items: [
      { type: "action", label: "New Session", action: newSession },
      { type: "separator" },
      { type: "action", label: "System Prompt…", action: async () => {
        const existing = await invoke<string | null>("get_system_prompt");
        setSystemPromptText(existing ?? "");
        setShowSystemPrompt(true);
      } },
      { type: "separator" },
      { type: "action", label: "Export Chat…", action: () => setShowExport(true) },
      { type: "separator" },
      { type: "action", label: "Configure Keys…", action: onConfigure },
      { type: "separator" },
      { type: "action", label: "Quit", action: () => window.close() },
    ]},
    { label: "Help", items: [
      { type: "action", label: "Open Data Directory", action: () => { invoke("open_data_dir").catch(console.error); }},
      { type: "separator" },
      { type: "action", label: "About", action: () => setShowAbout(true) },
    ]},
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, -apple-system, sans-serif", color: "var(--text, #333)", background: "var(--bg, #fff)" }}>
      <MenuBar menus={menus} />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar
          sessions={sessions}
          currentPath={currentSessionPath}
          models={models}
          currentModel={currentModel}
          onNewChat={newSession}
          onSelectSession={handleSelectSession}
          onRename={handleRenameSession}
          onDelete={handleDeleteSession}
          onSwitchModel={handleSwitchModel}
          themeMode={themeMode}
          onToggleTheme={toggleTheme}
          onToggleLang={toggleLang}
          language={lang}
          t={(k) => t(lang, k)}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px" }}
            onDrop={(e) => {
              e.preventDefault();
              const files = Array.from(e.dataTransfer.files);
              if (files.length > 0) {
                const paths = files.map((f) => f.path).join("\n");
                setMessages((m) => [...m, { role: "user", text: `请分析以下文件：\n${paths}` }]);
                setInput("");
              }
            }}
            onDragOver={(e) => e.preventDefault()}
          >
            {searchQuery && (
              <div style={{ padding: "4px 0", display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#999" }}>
                <input value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setSearchMatchIdx(0); }}
                  placeholder="Search messages…" autoFocus
                  style={{ flex: 1, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border, #ccc)", fontSize: 12 }} />
                <span>{searchMatchIdx + 1}/{messages.filter(m => m.text.toLowerCase().includes(searchQuery.toLowerCase())).length}</span>
                <span onClick={() => setSearchMatchIdx((i) => Math.min(i + 1, messages.length - 1))} style={{ cursor: "pointer" }}>↓</span>
                <span onClick={() => setSearchMatchIdx((i) => Math.max(i - 1, 0))} style={{ cursor: "pointer" }}>↑</span>
                <span onClick={() => setSearchQuery("")} style={{ cursor: "pointer", color: "#d32f2f" }}>✕</span>
              </div>
            )}
            {messages.length === 0 && !loading && <p style={{ color: "#bbb", textAlign: "center", marginTop: 80, fontSize: 14 }}>Start a conversation</p>}
            {messages.map((m, i) => {
              if (editingMsgIdx === i && m.role === "user") {
                return (
                  <div key={i} style={{ maxWidth: "85%", marginLeft: "auto", marginBottom: 12 }}>
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditSend(); } if (e.key === "Escape") setEditingMsgIdx(null); }}
                      style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #1976d2", fontSize: 14, minHeight: 60, resize: "vertical", boxSizing: "border-box" }} />
                    <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>Enter to send · Esc to cancel</div>
                  </div>
                );
              }
              return (
                <div key={i} onClick={m.role === "user" ? () => handleEditClick(i, m.text) : undefined}
                  style={{ cursor: m.role === "user" && !loading ? "pointer" : "default" }}>
                  <MessageBubble msg={m}
                    isLast={i === messages.length - 1}
                    onRegen={!loading && i === messages.length - 1 && m.role === "assistant" ? handleRegen : undefined}
                    onBranch={() => { setMessages((prev) => prev.slice(0, i + 1)); }} />
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
          <div style={{ padding: "8px 16px 16px", borderTop: "1px solid var(--border, #eee)", display: "flex", gap: 8 }}>
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="Type a message…" disabled={loading} autoFocus
              style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border, #ccc)", fontSize: 14, outline: "none", background: "var(--bg, #fff)", color: "var(--text, #333)" }} />
            {loading ? (
              <button onClick={async () => { await invoke("abort_prompt"); setLoading(false); }}
                style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#d32f2f", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                ■ Stop
              </button>
            ) : (
              <button onClick={send} disabled={loading}
                style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#1976d2", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                Send
              </button>
            )}
          </div>
        </div>
      </div>
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {showExport && currentSessionPath && <ExportDialog sessionPath={currentSessionPath} onClose={() => setShowExport(false)} />}
      {showSystemPrompt && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={() => setShowSystemPrompt(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg, #fff)", borderRadius: 12, padding: 24, maxWidth: 600, width: "90%", fontFamily: "system-ui, -apple-system, sans-serif" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16, color: "var(--text, #333)" }}>System Prompt</h3>
            <p style={{ fontSize: 12, color: "#999", marginBottom: 8 }}>Changes take effect on the next message.</p>
            <textarea value={systemPromptText} onChange={(e) => setSystemPromptText(e.target.value)}
              style={{ width: "100%", minHeight: 200, padding: 10, borderRadius: 6, border: "1px solid var(--border, #ccc)", fontSize: 13, fontFamily: "monospace", boxSizing: "border-box", resize: "vertical", background: "var(--bg, #fff)", color: "var(--text, #333)" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={() => setShowSystemPrompt(false)}
                style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid var(--border, #ccc)", background: "var(--bg, #fff)", cursor: "pointer", fontSize: 13, color: "var(--text, #333)" }}>Cancel</button>
              <button onClick={async () => {
                setSavingPrompt(true);
                await invoke("set_system_prompt", { prompt: systemPromptText });
                setSavingPrompt(false);
                setShowSystemPrompt(false);
              }} disabled={savingPrompt}
                style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: "#1976d2", color: "#fff", fontSize: 13, cursor: "pointer" }}>{savingPrompt ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Root ──

function App() {
  const [page, setPage] = useState<Page>("loading");
  const goToChat = useCallback(() => setPage("chat"), []);
  const goToSetup = useCallback(() => setPage("setup"), []);
  useEffect(() => {
    invoke<boolean>("check_auth_state").then((hasKeys) => setPage(hasKeys ? "chat" : "setup")).catch(() => setPage("setup"));
  }, []);
  if (page === "loading") return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#999", fontFamily: "system-ui, -apple-system, sans-serif" }}>Loading…</div>;
  if (page === "setup") return <SetupPage onDone={goToChat} />;
  return <ChatPage onConfigure={goToSetup} />;
}

export default App;
