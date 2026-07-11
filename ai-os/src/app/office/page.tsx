import { redirect } from "next/navigation";
import { isAuthed } from "@/server/auth";
import OfficeClient from "@/components/office/OfficeClient";

export default async function OfficePage() {
  if (!(await isAuthed())) redirect("/login");
  return <OfficeClient />;
}
