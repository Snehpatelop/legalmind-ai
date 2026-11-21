import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";

/** Documents list — polls while anything is still processing (real-time status). */
export function useDocuments() {
  return useQuery({
    queryKey: ["documents"],
    queryFn: api.documents,
    refetchInterval: (q) =>
      q.state.data?.some((d) => d.processing_status === "pending" || d.processing_status === "processing") ? 2000 : false,
  });
}

export function useReadyDocuments() {
  const q = useDocuments();
  return { ...q, ready: (q.data ?? []).filter((d) => d.processing_status === "ready") };
}

export function useSystemStatus() {
  return useQuery({ queryKey: ["system-status"], queryFn: api.systemStatus, staleTime: 60_000 });
}
