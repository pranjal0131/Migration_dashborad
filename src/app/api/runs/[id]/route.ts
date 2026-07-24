import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const run = await db.migrationRun.findFirst({
    where: { id, project: { userId: user.id } },
    select: {
      id: true, status: true, progress: true, stageMessage: true, totalPages: true,
      processedPages: true, okPages: true, missingPages: true, differsPages: true,
      errorPages: true, errorMessage: true, completedAt: true,
    },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run });
}
