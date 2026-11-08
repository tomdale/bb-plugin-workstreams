import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installGalleryHost } from "./host.tsx";
import App from "./App.tsx";
import "./base.css";

installGalleryHost();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
