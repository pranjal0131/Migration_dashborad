import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth";
export default async function Login(){ if(await getCurrentUser()) redirect("/dashboard"); return <AuthForm mode="login"/>; }
