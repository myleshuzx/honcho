"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { DocumentsView } from "@/components/documents-view";
import { MemoriesView } from "@/components/memories-view";
import { RecallView } from "@/components/recall-view";
import { ReflectView } from "@/components/reflect-view";
import { Sidebar, type ViewId } from "@/components/sidebar";
import { StatusView } from "@/components/status-view";
import { WorkspaceSelector } from "@/components/workspace-selector";
import { api, workspaceRoute } from "@/lib/api";
import type { WorkspaceInfo } from "@/lib/types";

function isView(value: string | null): value is ViewId {
  return value === "memories" || value === "recall" || value === "reflect" || value === "documents" || value === "status";
}

export default function WorkspacePage() {
  const params = useParams<{ workspaceId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const workspaceId = decodeURIComponent(params.workspaceId);
  const rawView = searchParams.get("view");
  const view: ViewId = isView(rawView) ? rawView : "memories";
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);

  useEffect(() => {
    api.listWorkspaces().then((response) => setWorkspaces(response.workspaces));
  }, []);

  return (
    <div className="shell">
      <WorkspaceSelector workspaces={workspaces} currentWorkspace={workspaceId} />
      <div className="main">
        <Sidebar currentView={view} onViewChange={(next) => router.push(workspaceRoute(workspaceId, next))} />
        <main className="content">
          {view === "memories" && <MemoriesView workspaceId={workspaceId} />}
          {view === "recall" && <RecallView workspaceId={workspaceId} />}
          {view === "reflect" && <ReflectView workspaceId={workspaceId} />}
          {view === "documents" && <DocumentsView workspaceId={workspaceId} />}
          {view === "status" && <StatusView workspaceId={workspaceId} />}
        </main>
      </div>
    </div>
  );
}
