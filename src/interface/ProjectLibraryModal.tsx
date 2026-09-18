import { Archive, Database, Loader2, Pencil, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { memoryApi } from '../core/persistence/api';
import {
  loadSavedProject,
  refreshProjects,
  retryMemoryConnection,
  startNewProject,
} from '../core/persistence/coordinator';
import { useMemoryStore } from '../integration/store/memoryStore';

export function ProjectLibraryModal() {
  const [teamFilter, setTeamFilter] = useState('all');
  const {
    status,
    error,
    hydrating,
    isLibraryOpen,
    projects,
    currentProjectId,
    setLibraryOpen,
  } = useMemoryStore();
  if (!isLibraryOpen) return null;
  const teams = [...new Set(projects.map((project) => project.teamId))];
  const visibleProjects = teamFilter === 'all'
    ? projects
    : projects.filter((project) => project.teamId === teamFilter);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refreshProjects();
    } catch (caught) {
      useMemoryStore.getState().setStatus('offline', caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-[760px] max-w-full flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-zinc-900">
              <Database size={16} /> Project memory
            </h2>
            <p className="mt-1 text-[11px] text-zinc-500">
              {status === 'online' ? 'Saved to local MySQL and disk' : 'Browser-only fallback mode'}
            </p>
          </div>
          <button onClick={() => setLibraryOpen(false)} className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100">
            <X size={17} />
          </button>
        </div>

        {status !== 'online' && (
          <div className="m-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-bold text-amber-900">MySQL memory is unavailable.</p>
            <p className="mt-1 text-[10px] text-amber-700">{error || 'Start MySQL and the memory API.'}</p>
            <button
              onClick={() => retryMemoryConnection()}
              className="mt-3 flex items-center gap-1 rounded-lg bg-amber-900 px-3 py-2 text-[9px] font-black uppercase text-white"
            >
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-6 py-3">
          <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
            {projects.length} saved project{projects.length === 1 ? '' : 's'}
          </span>
          <select
            value={teamFilter}
            onChange={(event) => setTeamFilter(event.target.value)}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[10px] font-bold text-zinc-600"
          >
            <option value="all">All teams</option>
            {teams.map((team) => <option key={team} value={team}>{team}</option>)}
          </select>
          <button
            onClick={() => {
              startNewProject();
              setLibraryOpen(false);
            }}
            className="flex items-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white"
          >
            <Plus size={12} /> New project
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-5">
          {hydrating && (
            <div className="flex justify-center py-12 text-zinc-400"><Loader2 className="animate-spin" /></div>
          )}
          {!hydrating && status === 'online' && projects.length === 0 && (
            <p className="py-12 text-center text-xs text-zinc-400">No saved projects yet.</p>
          )}
          {!hydrating && visibleProjects.map((project) => (
            <article
              key={project.id}
              className={`flex items-center justify-between gap-4 rounded-2xl border p-4 ${
                currentProjectId === project.id ? 'border-violet-300 bg-violet-50/40' : 'border-zinc-200'
              }`}
            >
              <div className="min-w-0">
                <h3 className="truncate text-sm font-black text-zinc-900">{project.title}</h3>
                <p className="mt-1 text-[10px] text-zinc-500">
                  {project.teamId} · {project.phase} · {new Date(project.updatedAt).toLocaleString()}
                </p>
                {project.brief && <p className="mt-2 line-clamp-2 text-[10px] text-zinc-500">{project.brief}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => run(async () => {
                    await loadSavedProject(project.id);
                    setLibraryOpen(false);
                  })}
                  className="rounded-lg bg-violet-600 p-2 text-white"
                  title="Resume"
                >
                  <Play size={13} />
                </button>
                <button
                  onClick={() => {
                    const title = window.prompt('Project name', project.title);
                    if (title?.trim()) void run(() => memoryApi.updateProject(project.id, { title: title.trim() }));
                  }}
                  className="rounded-lg border border-zinc-200 p-2 text-zinc-500"
                  title="Rename"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => run(() => memoryApi.updateProject(project.id, { archived: true }))}
                  className="rounded-lg border border-zinc-200 p-2 text-zinc-500"
                  title="Archive"
                >
                  <Archive size={13} />
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete "${project.title}" and its saved assets?`)) {
                      void run(() => memoryApi.deleteProject(project.id));
                    }
                  }}
                  className="rounded-lg border border-red-100 p-2 text-red-500"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
