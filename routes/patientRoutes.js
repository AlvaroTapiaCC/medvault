const express = require("express");

module.exports = ({ pool, requireAuth }) => {
  const router = express.Router();

  // ============================================================================
  // ENDPOINTS DE PACIENTES (Gestión de Pacientes - Entrega 1.1)
  // ============================================================================

  /**
   * GET /patients - Listar todos los pacientes
   * Requiere autenticación.
   */
  router.get("/patients", requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT patient_id, national_id, full_name, sex, birth_date, phone, address, insurance, notes FROM patients ORDER BY full_name ASC"
      );
      return res.json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /patients - Crear nuevo paciente
   * Requiere autenticación.
   */
  router.post("/patients", requireAuth, async (req, res) => {
    const { full_name, national_id, birth_date, sex, phone, address, insurance, notes } = req.body;

    // Validación básica
    if (!full_name || !national_id || !birth_date) {
      return res.status(400).json({ error: "Faltan campos requeridos: full_name, national_id, birth_date" });
    }

    try {
      // Generar un nuevo patient_id (formato P000XXX)
      const countResult = await pool.query("SELECT COUNT(*) as count FROM patients");
      const newId = `P${String(countResult.rows[0].count + 1).padStart(6, "0")}`;

      const result = await pool.query(
        `INSERT INTO patients (patient_id, national_id, full_name, sex, birth_date, phone, address, insurance, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [newId, national_id, full_name, sex || "X", birth_date, phone || null, address || null, insurance || null, notes || null]
      );

      // Crear la ficha clínica automáticamente
      await pool.query(
        "INSERT INTO clinical_files (patient_id) VALUES ($1)",
        [newId]
      );

      return res.status(201).json({ success: true, patient: result.rows[0] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // ENDPOINTS DE FICHAS CLÍNICAS (Gestión de Ficha Clínica - Entrega 1.1)
  // ============================================================================

  /**
   * GET /patients/:id/records - Obtener historial de atenciones clínicas de un paciente
   * Requiere autenticación.
   */
  router.get("/patients/:id/records", requireAuth, async (req, res) => {
    const patientId = req.params.id;

    try {
      // Obtener la ficha clínica del paciente
      const fileResult = await pool.query(
        "SELECT file_id FROM clinical_files WHERE patient_id = $1",
        [patientId]
      );

      if (fileResult.rows.length === 0) {
        return res.status(404).json({ error: "Ficha clínica no encontrada" });
      }

      const fileId = fileResult.rows[0].file_id;

      // Obtener todas las atenciones de esa ficha en orden cronológico
      const recordsResult = await pool.query(
        `SELECT ma.record_id, ma.visit_date, ma.diagnosis, ma.observations, ma.doctor_id, u.full_name as doctor_name
         FROM medical_atentions ma
         LEFT JOIN users u ON ma.doctor_id = u.user_id
         WHERE ma.file_id = $1
         ORDER BY ma.visit_date DESC`,
        [fileId]
      );

      return res.json(recordsResult.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /patients/:id/records - Crear nueva atención clínica para un paciente
   * Requiere autenticación.
   */
  router.post("/patients/:id/records", requireAuth, async (req, res) => {
    const patientId = req.params.id;
    const { visit_date, diagnosis, observations } = req.body;
    const doctorId = req.session.userId; // El doctor es el usuario autenticado

    // Validación básica
    if (!visit_date || !diagnosis) {
      return res.status(400).json({ error: "Faltan campos requeridos: visit_date, diagnosis" });
    }

    try {
      // Obtener la ficha clínica del paciente
      const fileResult = await pool.query(
        "SELECT file_id FROM clinical_files WHERE patient_id = $1",
        [patientId]
      );

      if (fileResult.rows.length === 0) {
        return res.status(404).json({ error: "Ficha clínica no encontrada" });
      }

      const fileId = fileResult.rows[0].file_id;

      // Insertar la nueva atención
      const result = await pool.query(
        `INSERT INTO medical_atentions (file_id, doctor_id, visit_date, diagnosis, observations)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [fileId, doctorId, visit_date, diagnosis, observations || null]
      );

      return res.status(201).json({ success: true, record: result.rows[0] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
};
