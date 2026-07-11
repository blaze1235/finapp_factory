import { redirect } from "next/navigation";
import { isAuthed } from "@/server/auth";
import Nav from "@/components/shell/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthed())) redirect("/login");
  return (
    <div className="flex h-screen overflow-hidden">
      <Nav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
