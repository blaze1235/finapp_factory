import { Suspense } from "react";
import AgentsClient from "@/components/agents/AgentsClient";

export default function AgentsPage() {
  return (
    <Suspense>
      <AgentsClient />
    </Suspense>
  );
}
