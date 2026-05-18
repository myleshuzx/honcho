"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { WorkspaceSelector } from "@/components/workspace-selector";
import { api } from "@/lib/api";
import type { WorkspaceInfo } from "@/lib/types";

export default function DashboardPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);

  useEffect(() => {
    api.listWorkspaces().then((response) => setWorkspaces(response.workspaces));
  }, []);

  return (
    <div className="shell">
      <WorkspaceSelector workspaces={workspaces} />
      <main className="content">
        <EmptyState
          title="Select a workspace"
          body="Choose a workspace from the top selector to inspect memories, recall, reflect, documents, and live processing status."
        />
      </main>
    </div>
  );
}
