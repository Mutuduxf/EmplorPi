import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ExportDialog from "./ExportDialog";
import TokenUsage from "./TokenUsage";

type Page = "loading" | "setup" | "chat";

interface Message {
  role: "user" | "assistant";
  text: string;
  thinking?: string;
}

interface SessionMeta {
  path: string;
  name: string;
  date: string;
  messageCount: number;
  model: string;
}

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI (GPT)" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "google", label: "Google (Gemini)" },
] as const;

// ── Menu bar ──

type MenuItem = { type: "action"; label: string; action: () => void } | { type: "separator" };

function MenuBar({ onNewChat, onConfigure, onExport }: { onNewChat: () => void; onConfigure: () => void; onExport: () => void }) {
  const menus = [
    { label: "File", items: [
      { type: "action" as const, label: "New Session", action: onNewChat },
      { type: "separator" as const },
      { type: "action" as const, label: "Export Chat…", action: onExport },
      { type: "separator" as const },
      { type: "action" as const, label: "Configure Keys…", action: onConfigure },
    ]},
  ];

  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openMenu === null) return;
    const handler = (e: MouseEvent) => { if (!barRef.current?.contains(e.target as Node)) setOpenMenu(null); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);

  return (
    <div ref={barRef} style={{ display: "flex", alignItems: "center", height: 32, background: "var(--msg-assistant, #f5f5f5)", borderBottom: "1px solid #ddd", userSelect: "none", fontFamily: "system-ui", fontSize: 13, flexShrink: 0 }}>
      {menus.map((menu, mi) => (
        <div key={mi} style={{ position: "relative" }}>
          <div onClick={() => setOpenMenu(openMenu === mi ? null : mi)}
            onMouseEnter={() => { if (openMenu !== null) setOpenMenu(mi); }}
            style={{ padding: "4px 10px", cursor: "pointer", borderRadius: 4, background: openMenu === mi ? "#e0e0e0" : "transparent", marginLeft: 2 }}>
            {menu.label}
          </div>
          {openMenu === mi && (
            <div style={{ position: "absolute", top: "100%", left: 0, minWidth: 180, background: "var(--bg, #fff)", border: "1px solid var(--border, #ccc)", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", padding: "4px 0", zIndex: 50 }}>
              {menu.items.map((item, ii) =>
                item.type === "separator"
                  ? <div key={ii} style={{ height: 1, background: "#e0e0e0", margin: "4px 8px" }} />
                  : <div key={ii} onClick={() => { setOpenMenu(null); item.action(); }} style={{ padding: "6px 16px", cursor: "pointer", fontSize: 13 }}>{item.label}</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Thinking collapsible ──

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 8, borderRadius: 6, border: "1px solid var(--border, #e0e0e0)", overflow: "hidden" }}>
      <div onClick={() => setOpen(!open)}
        style={{ padding: "6px 10px", background: "var(--sidebar-bg, #fafafa)", cursor: "pointer", fontSize: 12, color: "var(--text-secondary, #888)", display: "flex", alignItems: "center", gap: 6, userSelect: "none" }}>
        <span>{open ? "▼" : "▶"}</span> Thinking
      </div>
      {open && <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text, #666)", background: "var(--bg, #fefefe)", whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto" }}>{content}</div>}
    </div>
  );
}

// ── Simple Markdown renderer ──

function simpleMarkdown(text: string): string {
  let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Tables
  html = html.replace(/\n?\|([^\n]+)\|\n\|([-:| ]+)\|([\s\S]*?)(?=\n\n|\n[^|]|$)/g, (_, h, sep, body) => {
    const headers = h.split('|').map((c: string) => `<th>${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').filter((r: string) => r.includes('|')).map((r: string) =>
      `<tr>${r.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('')}</tr>`
    ).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });
  html = html
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^### (.+)/gm, "<h3>$1</h3>")
    .replace(/^## (.+)/gm, "<h2>$1</h2>")
    .replace(/^# (.+)/gm, "<h1>$1</h1>")
    .replace(/^- (.+)/gm, (m) => `<li>${m.slice(2)}</li>`)
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(.+)$/gm, (m) => m.startsWith("<") ? m : `<span>${m}</span>`);
  return html;
}

// ── Message bubble ──

function MarkdownBlock({ content }: { content: string }) {
  const html = useMemo(() => simpleMarkdown(content), [content]);
  return <div dangerouslySetInnerHTML={{ __html: html }} style={{ lineHeight: 1.6, fontSize: 14 }} />;
}

function MessageBubble({ msg }: { msg: Message }) {
  return (
    <div style={{ marginBottom: 8, maxWidth: "80%", marginLeft: msg.role === "user" ? "auto" : 0 }}>
      <div style={{ padding: "8px 12px", borderRadius: 8, background: msg.role === "user" ? "var(--msg-user, #e3f2fd)" : "var(--msg-assistant, #f5f5f5)" }}>
        {msg.role === "assistant" && msg.thinking && <ThinkingBlock content={msg.thinking} />}
        {msg.role === "user" ? (
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{msg.text}</div>
        ) : (
          <MarkdownBlock content={msg.text} />
        )}
      </div>
    </div>
  );
}

// ── Sidebar ──

function Sidebar({ sessions, currentPath, onNewChat, onSelectSession, onConfigure, themeMode, onToggleTheme }: { sessions: SessionMeta[]; currentPath?: string; onNewChat: () => void; onSelectSession: (path: string) => void; onConfigure: () => void; themeMode?: string; onToggleTheme?: () => void }) {
  const [search, setSearch] = useState("");
  const filtered = search.trim()
    ? sessions.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    : sessions;
  return (
    <div style={{ width: 260, height: "100%", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border, #ddd)", background: "var(--sidebar-bg, #fafafa)", fontFamily: "system-ui", flexShrink: 0 }}>
      <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border, #eee)" }}>
        <button onClick={onNewChat} style={{ width: "100%", padding: "8px 0", borderRadius: 6, border: "1px solid var(--border, #ccc)", background: "var(--bg, #fff)", color: "var(--text, #333)", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>+ New Chat</button>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
          style={{ width: "100%", marginTop: 6, padding: "5px 8px", borderRadius: 4, border: "1px solid var(--border, #ccc)", fontSize: 12, boxSizing: "border-box", background: "var(--bg, #fff)", color: "var(--text, #333)" }} />
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px" }}>
        {filtered.map((s) => (
          <div key={s.path} onClick={() => onSelectSession(s.path)}
            style={{ padding: "6px 10px", cursor: "pointer", borderRadius: 6, background: s.path === currentPath ? "var(--msg-user, #e3f2fd)" : "transparent", marginBottom: 1, fontSize: 13 }}>
            <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary, #999)" }}>{s.date?.slice(0, 10)} · {s.messageCount} msgs</div>
          </div>
        ))}
      </div>
      <div style={{ padding: "8px 10px", borderTop: "1px solid var(--border, #eee)", textAlign: "center" }}>
        <span onClick={onConfigure} style={{ fontSize: 12, color: "var(--text-secondary, #888)", cursor: "pointer" }}>Configure Keys</span>
        <br />
        <span onClick={onToggleTheme} style={{ fontSize: 12, color: "var(--text-secondary, #888)", cursor: "pointer" }}>{themeMode === "dark" ? "☀" : "🌙"}</span>
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
    if (!key.trim()) { setError("Enter an API key"); return; }
    setSaving(true); setError("");
    try { await invoke("save_api_key", { provider, key: key.trim() }); await invoke("switch_model", { provider, modelId: provider === "anthropic" ? "claude-sonnet-4-20250514" : provider === "deepseek" ? "deepseek-v4-pro" : provider === "openai" ? "gpt-4o" : "gemini-2.0-flash" }); onDone(); }
    catch (e) { setError(`Failed: ${e}`); }
    finally { setSaving(false); }
  };
  return (
    <div style={{ padding: 40, maxWidth: 480, margin: "auto", fontFamily: "system-ui" }}>
      <h1>Welcome</h1>
      <p style={{ color: "var(--text-secondary, #666)", marginBottom: 24 }}>Choose your LLM provider and enter an API key.</p>
      <select value={provider} onChange={(e) => setProvider(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 16, borderRadius: 6, border: "1px solid var(--border, #ccc)" }}>
        {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <input type="password" value={key} onChange={(e) => setKey(e.target.value)}
        placeholder="API Key"
        style={{ width: "100%", padding: 10, marginBottom: 12, borderRadius: 6, border: "1px solid var(--border, #ccc)", boxSizing: "border-box" }} />
      {error && <p style={{ color: "#d32f2f", fontSize: 13 }}>{error}</p>}
      <button onClick={handleSave} disabled={saving}
        style={{ width: "100%", padding: 10, borderRadius: 6, border: "none", background: "#1976d2", color: "#fff", fontSize: 16, cursor: "pointer" }}>
        {saving ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}

// ── Chat page ──

function ChatPage({ onConfigure }: { onConfigure: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [currentSessionPath, setCurrentSessionPath] = useState<string>();
  const [showExport, setShowExport] = useState(false);
  const [themeMode, setThemeMode] = useState("auto");
  const textRef = useRef("");

  // Dark mode CSS vars
  useEffect(() => {
    const root = document.documentElement;
    const isDark = themeMode === "dark" || (themeMode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.style.setProperty("--bg", isDark ? "#1e1e1e" : "#fff");
    root.style.setProperty("--bg-secondary", isDark ? "#2d2d2d" : "#f5f5f5");
    root.style.setProperty("--text", isDark ? "#e0e0e0" : "#333");
    root.style.setProperty("--text-secondary", isDark ? "#999" : "#666");
    root.style.setProperty("--border", isDark ? "#444" : "#ddd");
    root.style.setProperty("--msg-user", isDark ? "#1a3a5c" : "var(--msg-user, #e3f2fd)");
    root.style.setProperty("--msg-assistant", isDark ? "#2d2d2d" : "var(--msg-assistant, #f5f5f5)");
    root.style.setProperty("--sidebar-bg", isDark ? "#252525" : "#fafafa");
    root.style.color = "var(--text)";
    root.style.background = "var(--bg)";
  }, [themeMode]);

  const toggleTheme = useCallback(() => {
    setThemeMode((t: string) => (t === "dark" ? "light" : "dark"));
  }, []);

  const loadSessions = useCallback(async () => {
    try { setSessions(await invoke<SessionMeta[]>("list_sessions")); }
    catch { /* silent */ }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const send = useCallback(async () => {
    if (!input.trim() || loading) return;
    const text = input;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: "…" }]);
    setLoading(true);

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<string>("stream:update", (e) => {
        try {
          const parsed = JSON.parse(e.payload);
          if (typeof parsed === "object") {
            textRef.current = parsed.text ?? textRef.current;
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: "assistant", text: textRef.current || "…", thinking: parsed.thinking };
              return copy;
            });
          }
        } catch { /* skip */ }
      });

      const raw = await invoke<string>("send_prompt", { text });
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed.text !== undefined) {
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", text: parsed.text, thinking: parsed.thinking };
            return copy;
          });
        }
      } catch { /* use raw */ }
    } catch (e) {
      setMessages((prev) => { const c = [...prev]; c[c.length - 1] = { role: "assistant", text: `Error: ${e}` }; return c; });
    } finally {
      unlisten?.();
      setLoading(false);
      loadSessions();
      // Update session path for export
      try {
        const sp = await invoke<string | null>("get_session_path");
        if (sp) setCurrentSessionPath(sp);
      } catch {}
    }
  }, [input, loading, loadSessions]);

  const newSession = useCallback(() => {
    setMessages([]);
    setCurrentSessionPath(undefined);
  }, []);

  const handleSelectSession = useCallback((path: string) => {
    setCurrentSessionPath(path);
    setMessages([]);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui" }}>
      <MenuBar onNewChat={newSession} onConfigure={onConfigure} onExport={() => setShowExport(true)} />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar sessions={sessions} currentPath={currentSessionPath} onNewChat={newSession} onSelectSession={handleSelectSession} onConfigure={onConfigure} themeMode={themeMode} onToggleTheme={toggleTheme} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
          </div>
          <div style={{ padding: 16, borderTop: "1px solid #eee", display: "flex", gap: 8 }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
              style={{ flex: 1, padding: 10, borderRadius: 6, border: "1px solid var(--border, #ccc)", fontSize: 14, background: "var(--bg, #fff)", color: "var(--text, #333)" }} />
            <button onClick={send} disabled={loading}
              style={{ padding: "10px 20px", borderRadius: 6, border: "none", background: "#1976d2", color: "#fff", cursor: "pointer" }}>
              {loading ? "…" : "Send"}
            </button>
          </div>
        </div>
      </div>
      {showExport && <ExportDialog sessionPath={currentSessionPath || ""} onClose={() => setShowExport(false)} />}
    </div>
  );
}

function App() {
  const [page, setPage] = useState<Page>("loading");
  const goToSetup = useCallback(() => setPage("setup"), []);
  useEffect(() => {
    invoke<boolean>("check_auth_state")
      .then((hasKeys) => setPage(hasKeys ? "chat" : "setup"))
      .catch(() => setPage("setup"));
  }, []);
  if (page === "loading") return <div style={{ padding: 40, fontFamily: "system-ui", color: "var(--text-secondary, #999)" }}>Loading…</div>;
  if (page === "setup") return <SetupPage onDone={() => setPage("chat")} />;
  return <ChatPage onConfigure={goToSetup} />;
}
export default App;
