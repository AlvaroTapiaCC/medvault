const express = require("express");
const fs = require("fs");
const path = require("path");

module.exports = ({ upload, filesDir, requireAuth }) => {
  const router = express.Router();
  const resolvedFilesDir = path.resolve(filesDir);

  /**
   * POST /upload - Subir archivo. Requiere autenticación.
   */
  router.post("/upload", requireAuth, (req, res) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: "Upload fallido" });
      }
      if (!req.file) return res.status(400).json({ error: "No se adjuntó archivo" });

      const safeName = path.basename(req.file.originalname);
      const filePath = path.join(resolvedFilesDir, safeName);

      // Verificar que la ruta final permanece dentro del directorio autorizado
      if (!filePath.startsWith(resolvedFilesDir + path.sep) && filePath !== resolvedFilesDir) {
        return res.status(400).json({ error: "Nombre de archivo inválido" });
      }

      fs.writeFile(filePath, req.file.buffer, (err2) => {
        if (err2) return res.status(500).json({ error: "Error al guardar archivo" });
        return res.json({ success: true, file: safeName });
      });
    });
  });

  /**
   * GET /download/:filename - Descargar archivo. Requiere autenticación.
   * Protegido contra path traversal.
   */
  router.get("/download/:filename", requireAuth, (req, res) => {
    const requestedPath = path.resolve(resolvedFilesDir, req.params.filename);

    if (!requestedPath.startsWith(resolvedFilesDir + path.sep) && requestedPath !== resolvedFilesDir) {
      return res.status(400).json({ error: "Nombre de archivo inválido" });
    }

    if (!fs.existsSync(requestedPath)) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }

    return res.download(requestedPath, path.basename(requestedPath), (err) => {
      if (err) {
        res.status(500).json({ error: "Error al descargar archivo" });
      }
    });
  });

  /**
   * GET /files - Listar archivos disponibles. Requiere autenticación.
   */
  router.get("/files", requireAuth, (req, res) => {
    fs.readdir(resolvedFilesDir, (err, files) => {
      if (err) {
        return res.status(500).json({ error: "Error al listar archivos" });
      }
      return res.json({ success: true, files });
    });
  });

  return router;
};
