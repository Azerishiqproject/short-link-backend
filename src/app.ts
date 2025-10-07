import express from "express";
const authRoutes = require("./routes/auth");

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  return app;
}


