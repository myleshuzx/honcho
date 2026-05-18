"use client";

import { Activity, ChevronLeft, ChevronRight, Database, FileText, Search, Sparkles } from "lucide-react";
import { useState } from "react";

export type ViewId = "memories" | "recall" | "reflect" | "documents" | "status";

const items = [
  { id: "memories" as const, label: "Memories", icon: Database },
  { id: "recall" as const, label: "Recall", icon: Search },
  { id: "reflect" as const, label: "Reflect", icon: Sparkles },
  { id: "documents" as const, label: "Documents", icon: FileText },
  { id: "status" as const, label: "Live Status", icon: Activity }
];

export function Sidebar({
  currentView,
  onViewChange
}: {
  currentView: ViewId;
  onViewChange: (view: ViewId) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <aside className={`sidebar ${expanded ? "expanded" : ""}`}>
      <nav className="nav">
        {items.map((item) => {
          const Icon = item.icon;
          const active = currentView === item.id;
          return (
            <button
              key={item.id}
              className={`nav-item ${active ? "active" : ""}`}
              title={expanded ? undefined : item.label}
              onClick={() => onViewChange(item.id)}
            >
              <Icon size={19} />
              {expanded && <span className="nav-label">{item.label}</span>}
            </button>
          );
        })}
      </nav>
      <div className="collapse">
        <button className="nav-item" onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronLeft size={19} /> : <ChevronRight size={19} />}
          {expanded && <span className="nav-label">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
