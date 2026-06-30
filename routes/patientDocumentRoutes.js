const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { body, validationResult } = require("express-validator");
const { auditLog } = require("../logger");

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/dicom",
  "application/dicom"
]);

const ALLOWED_EXTENSIONS = new Set([".pdf", ".txt", ".jpg", ".jpeg", ".png", ".dcm"]);

module.exports = ({ pool, requireAuth, requireRole, upload, filesDir }) => {
  const router = express.Router();
  const documentsDir = path.join(filesDir, "documents");
  const resolvedDocsDir = path.resolve(documentsDir);

  if (!fs.existsSync(resolvedDocsDir)) {
    fs.mkdirSync(resolvedDocsDir, { recursive: true });
  }

  /**
   * GET /patients/:id/documents - Listar documentos.
   * Roles: admin, doctor, nurse.
   */
  router.get("/patients/:id/documents", requireRole("admin", "doctor", "nurse"), auditLog("list", "Document"), async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT d.doc_id, d.doc_type, d.doc_date, d.title, d.filename, d.sha256, d.created_at
         FROM documents d
         INNER JOIN patient_documents pd ON pd.doc_id = d.doc_id
         WHERE pd.patient_id = $1
         ORDER BY d.doc_date DESC, d.created_at DESC`,
        [req.params.id]
      );
      return res.json(result.rows);
    } catch (error) {
      console.error("Error al listar documentos:", error);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  /**
   * POST /patients/:id/documents - Subir documento.
   * Roles: admin, doctor.
   * Valida tipo MIME y extensión antes de guardar.
   */
  router.post("/patients/:id/documents", requireRole("admin", "doctor"), auditLog("upload", "Document"), (req, res) => {
    upload.single("file")(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: "Error al subir archivo" });
      }

      const patientId = req.params.id;
      const uploadedFile = req.file;

      if (!uploadedFile) {
        return res.status(400).json({ error: "Debe adjuntar un archivo" });
      }

      // Validar tipo MIME
      if (!ALLOWED_MIME_TYPES.has(uploadedFile.mimetype)) {
        return res.status(400).json({ error: "Tipo de archivo no permitido. Use PDF, TXT o imágenes médicas." });
      }

      // Validar extensión
      const ext = path.extname(uploadedFile.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return res.status(400).json({ error: "Extensión de archivo no permitida." });
      }

      const { title, doc_type, doc_date } = req.body;

      if (!title || !doc_type || !doc_date) {
        return res.status(400).json({ error: "Faltan campos requeridos: title, doc_type, doc_date" });
      }

      const validDocTypes = ["imaging", "discharge", "referral", "prescription", "lab"];
      if (!validDocTypes.includes(doc_type)) {
        return res.status(400).json({ error: "Tipo de documento inválido" });
      }

      const safeFileName = path.basename(uploadedFile.originalname);
      const destinationPath = path.join(resolvedDocsDir, safeFileName);

      // Verificar path traversal
      if (!destinationPath.startsWith(resolvedDocsDir + path.sep) && destinationPath !== resolvedDocsDir) {
        return res.status(400).json({ error: "Nombre de archivo inválido" });
      }

      const fileHash = crypto.createHash("sha256").update(uploadedFile.buffer).digest("hex");

      try {
        const patientResult = await pool.query(
          "SELECT patient_id FROM patients WHERE patient_id = $1",
          [patientId]
        );
        if (patientResult.rows.length === 0) {
          return res.status(404).json({ error: "Paciente no encontrado" });
        }

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
           VALUES ($1, $2) ON CONFLICT (patient_id, doc_id) DO NOTHING`,
          [patientId, newDocId]
        );

        return res.status(201).json({
          success: true,
          document: { doc_id: newDocId, doc_type, doc_date, title, filename: safeFileName, sha256: fileHash }
        });
      } catch (error) {
        console.error("Error al guardar documento:", error);
        return res.status(500).json({ error: "Error interno del servidor" });
      }
    });
  });

  /**
   * GET /patients/:id/documents/:docId/download - Descargar documento.
   * Roles: admin, doctor, nurse.
   * Verifica que el documento pertenece al paciente (mitigación IDOR).
   */
  router.get("/patients/:id/documents/:docId/download", requireRole("admin", "doctor", "nurse"), auditLog("download", "Document"), async (req, res) => {
    const { id: patientId, docId } = req.params;

    try {
      const result = await pool.query(
        `SELECT d.filename
         FROM documents d
         INNER JOIN patient_documents pd ON pd.doc_id = d.doc_id
         WHERE d.doc_id = $1 AND pd.patient_id = $2`,
        [docId, patientId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Documento no encontrado para este paciente" });
      }

      const filename = path.basename(result.rows[0].filename);
      const filePath = path.join(resolvedDocsDir, filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Archivo no encontrado en almacenamiento" });
      }

      return res.download(filePath, filename, (err) => {
        if (err) res.status(500).json({ error: "Error al descargar archivo" });
      });
    } catch (error) {
      console.error("Error al descargar documento:", error);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  /**
   * GET /patients/:id/documents/:docId/content - Obtener contenido de documento.
   * Roles: admin, doctor, nurse.
   * Verifica que el documento pertenece al paciente (mitigación IDOR).
   */
  router.get("/patients/:id/documents/:docId/content", requireRole("admin", "doctor", "nurse"), auditLog("read_content", "Document"), async (req, res) => {
    const { id: patientId, docId } = req.params;

    try {
      const result = await pool.query(
        `SELECT d.doc_id, d.title, d.doc_type, d.doc_date, d.filename
         FROM documents d
         INNER JOIN patient_documents pd ON pd.doc_id = d.doc_id
         WHERE d.doc_id = $1 AND pd.patient_id = $2`,
        [docId, patientId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Documento no encontrado para este paciente" });
      }

      const document = result.rows[0];
      const filename = path.basename(document.filename);
      const filePath = path.join(resolvedDocsDir, filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Archivo no encontrado en almacenamiento" });
      }

      const content = fs.readFileSync(filePath, "utf8");
      return res.json({ ...document, content });
    } catch (error) {
      console.error("Error al leer contenido de documento:", error);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  return router;
};
