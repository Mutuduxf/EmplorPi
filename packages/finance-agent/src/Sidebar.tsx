import { useState, useMemo } from "react";
import type { SessionMeta, ModelInfo } from "./types";

interface SidebarProps {
  sessions: SessionMeta[];
  currentPath?: string;
  models: ModelInfo[];
  currentModel?: string;
  onNewChat: () => void;
  onSelectSession: (path: string) => void;
  onRename: (path: string, name: string) => void;
  onDelete: (path: string) => void;
  onSwitchModel: (provider: string, modelId: string) => void;
  themeMode: string;
  onToggleTheme: () => void;
  onToggleLang: () => void;
  language: string;
  t: (key: string) => string;
}

export default function Sidebar(props: SidebarProps) {
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return props.sessions;
    const q = search.toLowerCase();
    return props.sessions.filter((s) => s.name.toLowerCase().includes(q));
  }, [props.sessions, search]);

  const sessionItems = filtered.map((s) => {
    const active = s.path === props.currentPath;
    const dateStr = s.date ? s.date.slice(0, 10) : "";
    return (
      <div key={s.path} onClick={() => props.onSelectSession(s.path)} style={{
        padding: "6px 10px", cursor: "pointer", borderRadius: 6,
        background: active ? "var(--msg-user, #e3f2fd)" : "transparent",
        marginBottom: 1, fontSize: 13,
      }}>
        {editingPath === s.path ? (
          <input value={editName} onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { props.onRename(s.path, editName); setEditingPath(null); } if (e.key === "Escape") setEditingPath(null); }}
            autoFocus style={{ width: "100%", padding: "2px 6px", fontSize: 13, border: "1px solid #1976d2", borderRadius: 4, boxSizing: "border-box" }} />
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}
            onMouseEnter={(e) => { const b = e.currentTarget.querySelector(".sa") as HTMLElement; if (b) b.style.display = "flex"; }}
            onMouseLeave={(e) => { const b = e.currentTarget.querySelector(".sa") as HTMLElement; if (b) b.style.display = "none"; }}>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 13, color: "var(--text, #333)" }}>{s.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary, #999)" }}>{dateStr} · {s.message_count} msgs</div>
            </div>
            <div className="sa" style={{ display: "none", gap: 2, alignItems: "center" }}>
              <span title={props.t("rename")} style={{ cursor: "pointer", fontSize: 12, color: "#999", padding: "0 2px" }}
                onClick={(e) => { e.stopPropagation(); setEditingPath(s.path); setEditName(s.name); }}>✎</span>
              <span title={props.t("delete")} style={{ cursor: "pointer", fontSize: 12, color: "#d32f2f", padding: "0 2px" }}
                onClick={(e) => { e.stopPropagation(); if (confirm(props.t("deleteConfirm"))) props.onDelete(s.path); }}>✕</span>
            </div>
          </div>
        )}
      </div>
    );
  });

  return (
    <div style={{
      width: 260, height: "100%", display: "flex", flexDirection: "column",
      borderRight: "1px solid var(--border, #ddd)", background: "var(--sidebar-bg, #fafafa)",
      fontFamily: "system-ui, -apple-system, sans-serif", flexShrink: 0,
    }}>
      <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border, #eee)" }}>
        <button onClick={props.onNewChat} style={{
          width: "100%", padding: "8px 0", borderRadius: 6, border: "1px solid var(--border, #ccc)",
          background: "var(--bg, #fff)", cursor: "pointer", fontSize: 13, fontWeight: 600,
          color: "var(--text, #333)",
        }}>+ {props.t("newChat")}</button>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={props.t("searchSessions")}
          style={{ width: "100%", marginTop: 6, padding: "5px 8px", borderRadius: 4, border: "1px solid var(--border, #ccc)", fontSize: 12, boxSizing: "border-box", background: "var(--bg, #fff)", color: "var(--text, #333)" }} />
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px" }}>
        {sessionItems.length === 0 && <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: "#999" }}>{props.t("noSessions")}</div>}
        {sessionItems}
      </div>
      <div style={{ padding: "8px 10px", borderTop: "1px solid var(--border, #eee)" }}>
        <select value={props.currentModel || ""} onChange={(e) => {
          const [provider, modelId] = e.target.value.split("/");
          props.onSwitchModel(provider, modelId);
        }} style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid var(--border, #ccc)", fontSize: 12, background: "var(--bg, #fff)", color: "var(--text, #333)" }}>
          {props.models.map((m) => (
            <option key={`${m.provider}/${m.modelId}`} value={`${m.provider}/${m.modelId}`}>{m.name || `${m.provider}/${m.modelId}`}</option>
          ))}
        </select>
        <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888" }}>
          <span onClick={props.onToggleTheme} style={{ cursor: "pointer" }}>{props.themeMode === "dark" ? "☀" : "🌙"}</span>
          <span onClick={props.onToggleLang} style={{ cursor: "pointer" }}>{props.language === "zh" ? "EN" : "中"}</span>
        </div>
      </div>
    </div>
  );
}
