import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { normalizePublicUrl, projectSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = projectSchema.parse(await request.json());
    const oldUrl = normalizePublicUrl(input.oldUrl);
    const newUrl = normalizePublicUrl(input.newUrl);
    if (oldUrl === newUrl) throw new Error("Old and new URLs must be different");
    const project = await db.migrationProject.create({
      data: {
        name: input.name,
        oldUrl,
        newUrl,
        userId: user.id,
        runs: { create: { maxPages: input.maxPages } },
      },
      include: { runs: true },
    });
    return NextResponse.json({ project, run: project.runs[0] }, { status: 201 });
  } catch (error) {
    return apiError(error, "Could not create migration project");
  }
}
