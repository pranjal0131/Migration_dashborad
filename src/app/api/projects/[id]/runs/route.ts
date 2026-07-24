import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const project = await db.migrationProject.findFirst({ where: { id, userId: user.id } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const active = await db.migrationRun.findFirst({
    where: { projectId: id, status: { in: ["QUEUED", "CRAWLING", "COMPARING"] } },
  });
  if (active) return NextResponse.json({ error: "An audit is already running" }, { status: 409 });
  const previous = await db.migrationRun.findFirst({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
  const run = await db.migrationRun.create({ data: { projectId: id, maxPages: previous?.maxPages ?? 500 } });
  return NextResponse.json({ run }, { status: 201 });
}
