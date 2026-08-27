import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { runReleaseGate } from "./release/releaseGate";

const shouldRender = runReleaseGate();
if (shouldRender) {
  createRoot(document.getElementById("root")!).render(<App />);
}
