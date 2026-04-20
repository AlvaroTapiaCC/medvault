const express = require("express");
const fs = require("fs");
const path = require("path");

module.exports = ({ upload, filesDir }) => {
  const router = express.Router();

  /**
   * Endpoint para subir archivos al servidor local.
   * Guarda el archivo en ./files con su nombre original.
   */
  router.post("/upload", (req, res) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: "Upload failed", details: err.message });
      }
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const filePath = path.join(filesDir, req.file.originalname);
      fs.writeFile(filePath, req.file.buffer, (err2) => {
        if (err2) return res.status(500).json({ error: "Error saving file", details: err2.message });
        return res.json({ success: true, file: req.file.originalname });
      });
    });
  });

  /**
   * Endpoint para descargar archivos desde el servidor local.
   */
  router.get("/download/:filename", (req, res) => {
    const filePath = path.join(filesDir, req.params.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    return res.download(filePath, req.params.filename, (err) => {
      if (err) {
        res.status(500).json({ error: "Error downloading file", details: err.message });
      }
    });
  });

  /**
   * Endpoint para listar los archivos disponibles en el directorio local.
   */
  router.get("/files", (req, res) => {
    fs.readdir(filesDir, (err, files) => {
      if (err) {
        return res.status(500).json({ error: "Error listing files", details: err.message });
      }
      return res.json({ success: true, files });
    });
  });

  return router;
};
