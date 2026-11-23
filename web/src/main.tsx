import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ImmersiveProvider } from "./immersive";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <ImmersiveProvider>
    <App />
  </ImmersiveProvider>,
);
