import { redirect } from "next/navigation";
import { isAuthed } from "@/server/auth";

export default async function Home() {
  redirect((await isAuthed()) ? "/office" : "/login");
}
