"use client";

import { BrainCircuit } from "lucide-react";
import { useRouter } from "next/navigation";
import type { WorkspaceInfo } from "@/lib/types";
import { workspaceRoute } from "@/lib/api";

export function WorkspaceSelector({
  workspaces,
  currentWorkspace
}: {
  workspaces: WorkspaceInfo[];
  currentWorkspace?: string;
}) {
  const router = useRouter();

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <BrainCircuit size={17} />
        </div>
        <div>
          <div>Honcho Control Plane</div>
          <div className="muted" style={{ fontSize: 12, fontWeight: 500 }}>
            {workspaces.length} workspaces
          </div>
        </div>
      </div>

      <select
        className="workspace-select"
        value={currentWorkspace ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          if (value) router.push(workspaceRoute(value));
        }}
      >
        <option value="">Select workspace</option>
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name} ({workspace.message_count} messages)
          </option>
        ))}
      </select>
    </header>
  );
}
