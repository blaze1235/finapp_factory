import { redirect } from "next/navigation";
import { isAuthed } from "@/server/auth";
import Nav from "@/components/shell/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthed())) redirect("/login");
  return (
    <div className="flex h-screen flex-col overflow-hidden md:flex-row">
      <Nav />
      <div className="min-h-0 min-w-0 flex-1 pb-14 md:pb-0">{children}</div>
    </div>
  );
}
