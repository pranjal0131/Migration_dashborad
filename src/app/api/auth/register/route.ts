import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { registerSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const input = registerSchema.parse(await request.json());
    const exists = await db.user.findUnique({ where: { email: input.email } });
    if (exists) return NextResponse.json({ error: "Email is already registered" }, { status: 409 });
    const user = await db.user.create({
      data: { name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12) },
    });
    await createSession(user.id);
    return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } }, { status: 201 });
  } catch (error) {
    return apiError(error, "Could not create account");
  }
}
