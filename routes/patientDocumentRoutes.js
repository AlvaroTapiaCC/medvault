const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

module.exports = ({ pool, requireAuth, upload, filesDir }) => {
  const router = express.Router();
  const documentsDir = path.join(filesDir, "documents");

  if (!fs.existsSync(documentsDir)) {
    fs.mkdirSync(documentsDir, { recursive: true });
  }

  // ============================================================================
  // ENDPOINTS DE DOCUMENTOS CLÍNICOS (Gestión de Documentos - Entrega 1.2)
  // ============================================================================

  /**
   * GET /patients/:id/documents - Listar documentos asociados a un paciente
   * Requiere autenticación.
   */
  router.get("/patients/:id/documents", requireAuth, async (req, res) => {
    const patientId = req.params.id;

    try {
      const result = await pool.query(
        `SELECT d.doc_id, d.doc_type, d.doc_date, d.title, d.filename, d.sha256, d.created_at
         FROM documents d
         INNER JOIN patient_documents pd ON pd.doc_id = d.doc_id
         WHERE pd.patient_id = $1
         ORDER BY d.doc_date DESC, d.created_at DESC`,
        [patientId]
      );

      return res.json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /patients/:id/documents - Subir y asociar documento a un paciente
   * Requiere autenticación.
   */
  router.post("/patients/:id/documents", requireAuth, (req, res) => {
    upload.single("file")(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: "Upload failed", details: err.message });
      }

      const patientId = req.params.id;
      const { title, doc_type, doc_date } = req.body;
      const uploadedFile = req.file;

      if (!uploadedFile) {
        return res.status(400).json({ error: "Debe adjuntar un archivo" });
      }

      if (!title || !doc_type || !doc_date) {
        return res.status(400).json({ error: "Faltan campos requeridos: title, doc_type, doc_date" });
      }

      const safeFileName = path.basename(uploadedFile.originalname);
      const destinationPath = path.join(documentsDir, safeFileName);
      const fileHash = crypto.createHash("sha256").update(uploadedFile.buffer).digest("hex");

      try {
        // Verificar que el paciente exista
        const patientResult = await pool.query(
          "SELECT patient_id FROM patients WHERE patient_id = $1",
          [patientId]
        );

        if (patientResult.rows.length === 0) {
          return res.status(404).json({ error: "Paciente no encontrado" });
        }

        // Generar doc_id consecutivo con formato D000XXX
        const countResult = await pool.query("SELECT COUNT(*)::int as count FROM documents");
        const newDocId = `D${String(countResult.rows[0].count + 1).padStart(6, "0")}`;

        fs.writeFileSync(destinationPath, uploadedFile.buffer);

        await pool.query(
          `INSERT INTO documents (doc_id, doc_type, doc_date, title, patient_id, filename, sha256)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [newDocId, doc_type, doc_date, title, patientId, safeFileName, fileHash]
        );

        await pool.query(
          `INSERT INTO patient_documents (patient_id, doc_id)
           VALUES ($1, $2)
           ON CONFLICT (patient_id, doc_id) DO NOTHING`,
          [patientId, newDocId]
        );

        return res.status(201).json({
          success: true,
          document: {
            doc_id: newDocId,
            doc_type,
            doc_date,
            title,
            filename: safeFileName,
            sha256: fileHash
          }
        });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    });
  });

  /**
   * GET /patients/:id/documents/:docId/download - Descargar documento de paciente
   * Requiere autenticación.
   */
  router.get("/patients/:id/documents/:docId/download", requireAuth, async (req, res) => {
    const patientId = req.params.id;
    const docId = req.params.docId;

    try {
      const result = await pool.query(
        `SELECT d.filename
         FROM documents d
         INNER JOIN patient_documents pd ON pd.doc_id = d.doc_id
         WHERE d.doc_id = $1 AND pd.patient_id = $2`,
        [docId, patientId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Documento no encontrado para el paciente" });
      }

      const filename = path.basename(result.rows[0].filename);
      const filePath = path.join(documentsDir, filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Archivo no encontrado en almacenamiento" });
      }

      return res.download(filePath, filename, (err) => {
        if (err) {
          res.status(500).json({ error: "Error descargando archivo", details: err.message });
        }
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
};
