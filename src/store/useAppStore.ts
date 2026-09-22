import { create } from "zustand";
import { KnowledgeBase, ReviewTask, UploadTask, ApiApp, GovernanceTask } from "@/types";
import { knowledgeBases } from "@/data/mock/knowledgeBases";
import { reviewTasks } from "@/data/mock/reviewTasks";
import { uploadTasks } from "@/data/mock/uploadTasks";
import { apiApps } from "@/data/mock/apiApps";
import { governanceTasks } from "@/data/mock/quality";

type ToastType = "success" | "info" | "warning";

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  type?: ToastType;
}

interface AppState {
  knowledgeBases: KnowledgeBase[];
  reviewTasks: ReviewTask[];
  uploadTasks: UploadTask[];
  apiApps: ApiApp[];
  governanceTasks: GovernanceTask[];
  toasts: ToastItem[];
  addKnowledgeBase: (item: KnowledgeBase) => void;
  addUploadTask: (item: UploadTask) => void;
  updateReviewStatus: (id: string, status: ReviewTask["status"]) => void;
  addApiApp: (item: ApiApp) => void;
  updateGovernanceTask: (id: string, status: GovernanceTask["status"]) => void;
  addToast: (toast: Omit<ToastItem, "id">) => void;
  dismissToast: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  knowledgeBases,
  reviewTasks,
  uploadTasks,
  apiApps,
  governanceTasks,
  toasts: [],
  addKnowledgeBase: (item) => set((state) => ({ knowledgeBases: [item, ...state.knowledgeBases] })),
  addUploadTask: (item) => set((state) => ({ uploadTasks: [item, ...state.uploadTasks] })),
  updateReviewStatus: (id, status) =>
    set((state) => ({
      reviewTasks: state.reviewTasks.map((task) => (task.id === id ? { ...task, status } : task))
    })),
  addApiApp: (item) => set((state) => ({ apiApps: [item, ...state.apiApps] })),
  updateGovernanceTask: (id, status) =>
    set((state) => ({
      governanceTasks: state.governanceTasks.map((task) => (task.id === id ? { ...task, status } : task))
    })),
  addToast: (toast) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
    }, 3200);
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }))
}));
