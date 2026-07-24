"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function ProjectForm() {
  const router = useRouter(); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setLoading(true);setError("");const values=Object.fromEntries(new FormData(event.currentTarget));const response=await fetch("/api/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(values)});const data=await response.json();setLoading(false);if(!response.ok)return setError(data.error??"Could not start audit");router.push(`/projects/${data.project.id}`);router.refresh();}
  return <div className="card panel"><h2>Start a migration audit</h2><p>Enter the website being replaced and its new version.</p><form className="form-grid" onSubmit={submit}>
    <div className="field full"><label htmlFor="name">Project name</label><input id="name" name="name" placeholder="Marketing website migration" required/></div>
    <div className="field"><label htmlFor="oldUrl">Old website URL</label><input id="oldUrl" name="oldUrl" type="url" placeholder="https://old.example.com" required/></div>
    <div className="field"><label htmlFor="newUrl">New website URL</label><input id="newUrl" name="newUrl" type="url" placeholder="https://new.example.com" required/></div>
    <div className="field"><label htmlFor="maxPages">Maximum pages</label><input id="maxPages" name="maxPages" type="number" defaultValue="500" min="1" max="2000"/></div>
    <div className="field" style={{justifyContent:"end"}}><button className="button" disabled={loading}>{loading?"Creating...":"Create project & audit"}</button></div>
    {error&&<div className="error field full">{error}</div>}
  </form></div>;
}
