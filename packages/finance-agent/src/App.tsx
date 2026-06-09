import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";

// ── Types ──

interface Message {
  role: "user" | "assistant";
  text: string;
  thinking?: string;
}

type Page = "loading" | "setup" | "chat";

// ── Markdown renderer ──

marked.setOptions({ breaks: true, gfm: true });

function MarkdownBlock({ content }: { content: string }) {
  const html = useRef<string>("");
  if (!html.current) {
    html.current = marked.parse(content, { async: false }) as string;
  }
  return (
    <div
      dangerouslySetInnerHTML={{ __html: html.current }}
      style={{ lineHeight: 1.6, fontSize: 14 }}
    />
  );
}

// ── Collapsible thinking block ──

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 8, borderRadius: 6, border: "1px solid #e0e0e0", overflow: "hidden" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding: "6px 10px", background: "#fafafa", cursor: "pointer",
          fontSize: 12, color: "#888", display: "flex", alignItems: "center",
          gap: 6, userSelect: "none",
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? "▼" : "▶"}</span>
        Thinking
      </div>
      {open && (
        <div
          style={{
            padding: "8px 10px", fontSize: 12, color: "#666",
            background: "#fefefe", whiteSpace: "pre-wrap", lineHeight: 1.5,
            maxHeight: 200, overflowY: "auto",
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
}

// ── Message bubble ──

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ marginBottom: 12, maxWidth: "85%", marginLeft: isUser ? "auto" : 0, marginRight: isUser ? 0 : "auto" }}>
      <div style={{ borderRadius: 10, padding: "10px 14px", background: isUser ? "#e3f2fd" : "#f5f5f5" }}>
        {!isUser && msg.thinking && <ThinkingBlock content={msg.thinking} />}
        <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5 }}>{msg.text}</div>
      </div>
    </div>
  );
}

// ── Providers ──

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
    <div ref={barRef} style={{ display: "flex", alignItems: "center", height: 32, background: "#f5f5f5", borderBottom: "1px solid #ddd", userSelect: "none", fontFamily: "system-ui, -apple-system, sans-serif", fontSize: 13, position: "relative", flexShrink: 0 }}>
      {menus.map((menu, mi) => (
        <div key={mi} style={{ position: "relative" }}>
          <div onClick={() => setOpenMenu(openMenu === mi ? null : mi)} onMouseEnter={() => { if (openMenu !== null) setOpenMenu(mi); }} style={{ padding: "4px 10px", cursor: "pointer", borderRadius: 4, background: openMenu === mi ? "#e0e0e0" : "transparent", marginLeft: 2 }}>{menu.label}</div>
          {openMenu === mi && (
            <div style={{ position: "absolute", top: "100%", left: 0, minWidth: 180, background: "#fff", border: "1px solid #ccc", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", padding: "4px 0", zIndex: 50 }}>
              {menu.items.map((item, ii) =>
                item.type === "separator" ? <div key={ii} style={{ height: 1, background: "#e0e0e0", margin: "4px 8px" }} />
                : <div key={ii} onClick={() => { setOpenMenu(null); item.action(); }} style={{ padding: "6px 16px", cursor: "pointer", fontSize: 13 }}
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { if (!loading) inputRef.current?.focus(); }, [loading]);

  const send = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userText = input;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: userText }]);
    setLoading(true);
    setMessages((m) => [...m, { role: "assistant", text: "Thinking…" }]);

    try {
      const raw = await invoke<string>("send_prompt", { text: userText });
      let text = raw;
      let thinking: string | undefined;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed.text !== undefined) {
          text = parsed.text;
          thinking = parsed.thinking;
        }
      } catch { /* use raw */ }

      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", text: text || "(empty)", thinking };
        return copy;
      });
    } catch (e) {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", text: `Error: ${e}` };
        return copy;
      });
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  const newSession = () => { setMessages([]); inputRef.current?.focus(); };

  const menus: MenuDef[] = [
    { label: "File", items: [
      { type: "action", label: "New Session", action: newSession },
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
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <MenuBar menus={menus} />
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px" }}>
        {messages.length === 0 && !loading && <p style={{ color: "#bbb", textAlign: "center", marginTop: 80, fontSize: 14 }}>Start a conversation</p>}
        {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: "8px 16px 16px", borderTop: "1px solid #eee", display: "flex", gap: 8 }}>
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()} placeholder="Type a message…" disabled={loading} autoFocus
          style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #ccc", fontSize: 14, outline: "none" }} />
        <button onClick={send} disabled={loading}
          style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: loading ? "#90caf9" : "#1976d2", color: "#fff", fontSize: 14, fontWeight: 600, cursor: loading ? "default" : "pointer" }}>
          {loading ? "…" : "Send"}
        </button>
      </div>
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
    </div>
  );
}

// ── Root ──

function App() {
  const [page, setPage] = useState<Page>("loading");
  useEffect(() => {
    invoke<boolean>("check_auth_state").then((hasKeys) => setPage(hasKeys ? "chat" : "setup")).catch(() => setPage("setup"));
  }, []);
  if (page === "loading") return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#999", fontFamily: "system-ui, -apple-system, sans-serif" }}>Loading…</div>;
  if (page === "setup") return <SetupPage onDone={() => setPage("chat")} />;
  return <ChatPage onConfigure={() => setPage("setup")} />;
}

export default App;
