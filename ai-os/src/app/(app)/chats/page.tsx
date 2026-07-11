import { Suspense } from "react";
import ChatsClient from "@/components/chats/ChatsClient";

export default function ChatsPage() {
  return (
    <Suspense>
      <ChatsClient />
    </Suspense>
  );
}
