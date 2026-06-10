import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { bootstrap } from "./auth/bootstrap";

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

import authRoutes from "./routes/auth";
import uploadRoutes from "./routes/upload";
import synonymRoutes from "./routes/synonyms";
import inventoryRoutes from "./routes/inventory";
import inTransitRoutes from "./routes/inTransit";
import recipeRoutes from "./routes/recipes";
import stockRoutes from "./routes/stock";
import dashboardRoutes from "./routes/dashboard";
import rawMaterialsRoutes from "./routes/rawMaterials";
import documentsRoutes from "./routes/documents";
import planningRoutes from "./routes/planning";

app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/synonyms", synonymRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/in-transit", inTransitRoutes);
app.use("/api/recipes", recipeRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/raw-materials", rawMaterialsRoutes);
app.use("/api/documents", documentsRoutes);
app.use("/api/planning", planningRoutes);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), storage: "PostgreSQL" });
});

const clientBuild = path.join(process.cwd(), "dist", "client");
app.use(express.static(clientBuild));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(clientBuild, "index.html"), err => {
    if (err) res.status(200).send("Server running. Build frontend to see the app.");
  });
});

bootstrap()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server on port ${port} | Storage: PostgreSQL + Google Sheets (legacy)`);
    });
  })
  .catch((err) => {
    console.error("[bootstrap] failed:", err);
    process.exit(1);
  });
