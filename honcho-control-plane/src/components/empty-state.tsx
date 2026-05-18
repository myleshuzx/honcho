import { Database } from "lucide-react";

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty card">
      <div>
        <Database size={42} />
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </div>
  );
}
