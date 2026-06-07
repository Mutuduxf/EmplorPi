import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Message {
  role: "user" | "assistant";
  text: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;

    const userText = input;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: userText }]);
    setLoading(true);

    try {
      const response = await invoke<string>("send_prompt", { text: userText });
      setMessages((m) => [...m, { role: "assistant", text: response }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: `Error: ${e}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", padding: "16px" }}>
      <div style={{ flex: 1, overflowY: "auto", marginBottom: "12px" }}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              marginBottom: "8px",
              padding: "8px 12px",
              borderRadius: "8px",
              background: m.role === "user" ? "#e3f2fd" : "#f5f5f5",
              maxWidth: "80%",
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <strong>{m.role === "user" ? "You" : "Agent"}:</strong>
            <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type a message..."
          disabled={loading}
          style={{ flex: 1, padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
        />
        <button
          onClick={send}
          disabled={loading}
          style={{ padding: "8px 16px", borderRadius: "4px", border: "none", background: "#1976d2", color: "#fff", cursor: "pointer" }}
        >
          {loading ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}

export default App;
