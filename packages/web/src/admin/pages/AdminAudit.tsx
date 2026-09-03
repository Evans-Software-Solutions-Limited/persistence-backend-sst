import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { adminApi } from "../adminApi";
import { EmptyState, ErrorState, PageHeader, Panel, Table } from "../ui";

export function AdminAudit() {
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const q = useQuery({
    queryKey: ["admin", "audit", entityType, entityId],
    queryFn: () =>
      adminApi.audit(entityType || undefined, entityId || undefined),
  });
  return (
    <>
      <PageHeader title="Audit log" />
      <Panel>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input
            placeholder="entity type (e.g. founding_grant)"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="max-w-xs"
            aria-label="Entity type"
          />
          <Input
            placeholder="entity id"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            className="max-w-xs"
            aria-label="Entity id"
          />
        </div>
        {q.isError ? <ErrorState error={q.error} /> : null}
        {q.data && q.data.length === 0 ? (
          <EmptyState>Nothing logged yet.</EmptyState>
        ) : null}
        {q.data && q.data.length > 0 ? (
          <Table head={["When", "Action", "Entity", "Reason", "Change"]}>
            {q.data.map((row) => (
              <tr key={row.id}>
                <td className="whitespace-nowrap">
                  {new Date(row.createdAt).toLocaleString("en-GB")}
                </td>
                <td className="font-mono text-xs">{row.action}</td>
                <td className="font-mono text-xs">
                  {row.entityType}
                  {row.entityId ? ` · ${row.entityId.slice(0, 8)}…` : ""}
                </td>
                <td>{row.reason ?? "—"}</td>
                <td>
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      view
                    </summary>
                    <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap text-xs">
                      {JSON.stringify(
                        { before: row.before, after: row.after },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Panel>
    </>
  );
}
