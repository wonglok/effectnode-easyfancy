import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ChatPanel from "./components/ChatPanel";
import PreviewPanel from "./components/PreviewPanel";
import { useChat } from "./store/chat";

export default function App() {
  useUnloadGuard();

  return (
    <Routes>
      <Route
        path="/"
        element={
          <div className="workspace">
            <ChatPanel />
            <PreviewPanel />
          </div>
        }
      />
      <Route
        path="/chat"
        element={
          <div className="chatOnly">
            <ChatPanel fullscreen />
          </div>
        }
      />
      <Route
        path="/preview"
        element={
          <div className="previewOnly">
            <PreviewPanel fullscreen />
          </div>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * While an agent run is in flight, closing or reloading the tab would abort
 * the work (the server cancels the child process on socket disconnect), so
 * ask the browser to confirm first. It is removed the moment the run ends.
 */
function useUnloadGuard(): void {
  const running = useChat((state) => state.running);

  useEffect(() => {
    if (!running) {
      window.onbeforeunload = null;
      return;
    }

    window.onbeforeunload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers require a truthy return value to show the prompt.
      event.returnValue = "";
      return "";
    };

    return () => {
      window.onbeforeunload = null;
    };
  }, [running]);
}
