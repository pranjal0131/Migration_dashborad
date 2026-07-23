import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth";
export default async function Register(){ if(await getCurrentUser()) redirect("/dashboard"); return <AuthForm mode="register"/>; }
