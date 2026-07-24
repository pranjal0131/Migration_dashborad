import Link from "next/link";
import { Nav } from "@/components/nav";
import { ProjectForm } from "@/components/project-form";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export default async function Dashboard(){const user=await requireUser();const projects=await db.migrationProject.findMany({where:{userId:user.id},orderBy:{createdAt:"desc"},include:{runs:{orderBy:{createdAt:"desc"},take:1}}});return <><Nav name={user.name}/><main className="shell main"><div className="page-head"><div><h1>Your migration projects</h1><p>Track route coverage and content parity across every website migration.</p></div></div><ProjectForm/><section style={{marginTop:30}}><h2>Projects</h2><div className="project-list">{projects.length===0?<div className="card empty">No migration projects yet. Create your first audit above.</div>:projects.map(project=>{const run=project.runs[0];return <Link className="card project" href={`/projects/${project.id}`} key={project.id}><div><div className="project-title">{project.name}</div><div className="urls">{project.oldUrl} → {project.newUrl}</div></div><div style={{textAlign:"right"}}><span className={`status ${run?.status}`}>{run?.status??"NOT STARTED"}</span><div className="urls" style={{marginTop:7}}>{run?`${run.processedPages}/${run.totalPages || "?"} pages · ${run.progress}%`:""}</div></div></Link>})}</div></section></main></>}
