import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/variables.css";
import "./styles/global.css";
import "./styles/app.css";
import "./styles/polish.css";
import "./styles/profile.css";
import "./styles/login.css";
import "./styles/landing.css";
import "./styles/owner.css";
import { registerServiceWorker } from "./utils/pwaUpdate";

registerServiceWorker();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
