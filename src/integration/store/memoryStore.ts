import { create } from 'zustand';
import { SavedProjectSummary } from '../../core/persistence/api';

interface MemoryState {
  status: 'checking' | 'online' | 'offline';
  error: string | null;
  initialized: boolean;
  hydrating: boolean;
  isLibraryOpen: boolean;
  currentProjectId: string | null;
  currentStoryId: string | null;
  projects: SavedProjectSummary[];
  setStatus: (status: MemoryState['status'], error?: string | null) => void;
  setInitialized: (initialized: boolean) => void;
  setHydrating: (hydrating: boolean) => void;
  setLibraryOpen: (open: boolean) => void;
  setCurrentProject: (projectId: string | null, storyId?: string | null) => void;
  setProjects: (projects: SavedProjectSummary[]) => void;
}

const storedProjectId = localStorage.getItem('delegation-current-project');
const storedStoryId = localStorage.getItem('delegation-current-story');

export const useMemoryStore = create<MemoryState>((set) => ({
  status: 'checking',
  error: null,
  initialized: false,
  hydrating: false,
  isLibraryOpen: false,
  currentProjectId: storedProjectId,
  currentStoryId: storedStoryId,
  projects: [],
  setStatus: (status, error = null) => set({ status, error }),
  setInitialized: (initialized) => set({ initialized }),
  setHydrating: (hydrating) => set({ hydrating }),
  setLibraryOpen: (isLibraryOpen) => set({ isLibraryOpen }),
  setCurrentProject: (currentProjectId, currentStoryId = null) => {
    if (currentProjectId) localStorage.setItem('delegation-current-project', currentProjectId);
    else localStorage.removeItem('delegation-current-project');
    if (currentStoryId) localStorage.setItem('delegation-current-story', currentStoryId);
    else localStorage.removeItem('delegation-current-story');
    set({ currentProjectId, currentStoryId });
  },
  setProjects: (projects) => set({ projects }),
}));
